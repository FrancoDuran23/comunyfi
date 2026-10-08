import { parseEther, type Address, type Hash, type Hex } from "viem";
import { prepareWarsTransfer, isPlaceholderRecipient } from "../wallet/payout.js";
import { DEFAULT_GAS_DROP_CELO, USDT_FEE_CURRENCY } from "./constants.js";
import { assertCalldataHasAttribution } from "./tag.js";

export interface RunnerLine {
  projectId: string;
  recipient: Address;
  amount: string;
}

export interface RunnerPlan {
  idempotencyKey: string;
  roundId: number;
  lines: RunnerLine[];
}

export interface RunnerTransferResult {
  recipient: Address;
  txHash?: Hash;
  celoTxHash?: Hash;
}

export interface ChainIo {
  getNonce(): Promise<number>;
  sendWars(tx: { to: Address; data: Hex; nonce: number; feeCurrency: Address | null }): Promise<Hash>;
  sendCelo(tx: { to: Address; value: bigint; nonce: number; feeCurrency: Address | null }): Promise<Hash>;
  wait(hash: Hash): Promise<void>;
  postResults(body: {
    idempotencyKey: string;
    dryRun: boolean;
    results: RunnerTransferResult[];
  }): Promise<void>;
}

export interface RunPayoutOptions {
  dryRun: boolean;
  gasDropWei: bigint;
  feeCurrency: Address | null;
  expectedKey?: string | null;
  plan: RunnerPlan;
  io: ChainIo;
}

export function gasDropWei(raw: string | undefined, enabled: boolean): bigint {
  if (!enabled) return 0n;
  const value = raw?.trim() || DEFAULT_GAS_DROP_CELO;
  if (value === "0") return 0n;
  return parseEther(value);
}

export function feeCurrencyFromFlag(raw: string | undefined): Address | null {
  const value = raw?.trim().toLowerCase() ?? "";
  if (!value || value === "celo" || value === "false" || value === "0") return null;
  if (value === "usdt" || value === "usdt0" || value === "usa₮") return USDT_FEE_CURRENCY;
  throw new Error("PAYOUT_FEE_CURRENCY tiene que ser usdt o vacío");
}

export function dryRunFromEnv(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase() ?? "";
  if (!value) return true;
  if (value === "false" || value === "0") return false;
  if (value === "true" || value === "1") return true;
  throw new Error("PAYOUT_DRY_RUN tiene que ser true o false");
}

/**
 * Manda un transfer etiquetado por destinatario, con nonce explícito, y espera el receipt.
 * El dry-run arma el calldata, chequea la etiqueta y no llama a la red.
 */
export async function runPayout(options: RunPayoutOptions): Promise<{ dryRun: boolean; sent: number }> {
  if (options.expectedKey && options.expectedKey !== options.plan.idempotencyKey) {
    throw new Error("La clave del plan no coincide con la del workflow");
  }
  const lines = options.plan.lines.filter((line) => BigInt(line.amount) > 0n);
  let nonce = options.dryRun ? 0 : await options.io.getNonce();
  const results: RunnerTransferResult[] = [];
  const paidRecipients: Address[] = [];

  for (const line of lines) {
    if (isPlaceholderRecipient(line.recipient)) {
      throw new Error(`Reemplazá el destinatario de relleno ${line.recipient} antes de un pago real`);
    }
    const prepared = prepareWarsTransfer(line.recipient, BigInt(line.amount));
    assertCalldataHasAttribution(prepared.data);
    if (options.dryRun) continue;
    const txHash = await options.io.sendWars({
      to: prepared.token,
      data: prepared.data,
      nonce,
      feeCurrency: options.feeCurrency,
    });
    nonce += 1;
    await options.io.wait(txHash);
    results.push({ recipient: line.recipient, txHash });
    paidRecipients.push(line.recipient);
    await options.io.postResults({
      idempotencyKey: options.plan.idempotencyKey,
      dryRun: false,
      results: [{ recipient: line.recipient, txHash }],
    });
  }

  if (!options.dryRun && options.gasDropWei > 0n) {
    const winners = [...new Set(paidRecipients)];
    for (const recipient of winners) {
      const celoTxHash = await options.io.sendCelo({
        to: recipient,
        value: options.gasDropWei,
        nonce,
        feeCurrency: options.feeCurrency,
      });
      nonce += 1;
      await options.io.wait(celoTxHash);
      await options.io.postResults({
        idempotencyKey: options.plan.idempotencyKey,
        dryRun: false,
        results: [{ recipient, celoTxHash }],
      });
    }
  }

  if (options.dryRun) {
    await options.io.postResults({
      idempotencyKey: options.plan.idempotencyKey,
      dryRun: true,
      results: [],
    });
  }

  return { dryRun: options.dryRun, sent: results.length };
}
