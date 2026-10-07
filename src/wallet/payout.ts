import {
  concat,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { comunyfiAttributionCode, comunyfiAttributionSuffix } from "../attribution.js";
import { CELO_CHAIN_ID, celoChain, WARS_TOKEN_ADDRESS } from "../chain.js";
import type { PayoutLine } from "../voting/types.js";

/** Direcciones 0x000…0001 del archivo de ejemplo. No sirven para un pago real. */
export function isPlaceholderRecipient(address: Address): boolean {
  return /^0x0{39}[0-9a-f]$/i.test(address);
}

export const PayoutErrorCode = {
  NOT_APPROVED: "NOT_APPROVED",
  NOTHING_TO_PAY: "NOTHING_TO_PAY",
  PLACEHOLDER_RECIPIENT: "PLACEHOLDER_RECIPIENT",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  MISSING_SIGNER: "MISSING_SIGNER",
  WRONG_CHAIN: "WRONG_CHAIN",
} as const;

export type PayoutErrorCode = (typeof PayoutErrorCode)[keyof typeof PayoutErrorCode];

export class PayoutError extends Error {
  readonly code: PayoutErrorCode;

  constructor(code: PayoutErrorCode, message: string) {
    super(message);
    this.name = "PayoutError";
    this.code = code;
  }
}

export interface PreparedWarsTransfer {
  chainId: typeof CELO_CHAIN_ID;
  token: Address;
  recipient: Address;
  amount: bigint;
  data: Hex;
  attributionCode: string;
}

export interface SendableTransfer {
  to: Address;
  data: Hex;
  value: 0n;
  chainId: typeof CELO_CHAIN_ID;
}

export interface PayoutSender {
  send(tx: SendableTransfer): Promise<Hash>;
}

export interface PayoutOutcome {
  dryRun: boolean;
  attributionCode: string;
  transfers: PreparedWarsTransfer[];
  hashes: Hash[];
}

/** Calldata de `transfer` de wARS con el sufijo ERC-8021 del repo. */
export function buildWarsTransferCalldata(recipient: Address, amount: bigint): Hex {
  if (amount <= 0n) {
    throw new PayoutError(PayoutErrorCode.INVALID_AMOUNT, "El monto de wARS tiene que ser positivo");
  }
  const to = getAddress(recipient);
  if (to === zeroAddress) {
    throw new PayoutError(PayoutErrorCode.PLACEHOLDER_RECIPIENT, "No se puede transferir a la dirección cero");
  }
  const callData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  });
  return concat([callData, comunyfiAttributionSuffix()]);
}

export function prepareWarsTransfer(recipient: Address, amount: bigint): PreparedWarsTransfer {
  const to = getAddress(recipient);
  return {
    chainId: CELO_CHAIN_ID,
    token: getAddress(WARS_TOKEN_ADDRESS),
    recipient: to,
    amount,
    data: buildWarsTransferCalldata(to, amount),
    attributionCode: comunyfiAttributionCode(),
  };
}

export function toSendable(prepared: PreparedWarsTransfer): SendableTransfer {
  return {
    to: prepared.token,
    data: prepared.data,
    value: 0n,
    chainId: prepared.chainId,
  };
}

export function celoscanTxUrl(hash: Hash): string {
  return `https://celoscan.io/tx/${hash}`;
}

export interface ExecutePayoutInput {
  lines: readonly PayoutLine[];
  approved: boolean;
  dryRun: boolean;
  sender?: PayoutSender;
  onSent?: (hash: Hash, transfer: PreparedWarsTransfer) => void;
}

/**
 * Paga cada línea con `transfer` de wARS.
 * En dry-run devuelve la transacción etiquetada y no llama al sender.
 * En vivo rechaza destinatarios de relleno (0x000…0001, etc.).
 */
export async function executePayout(input: ExecutePayoutInput): Promise<PayoutOutcome> {
  if (!input.approved) {
    throw new PayoutError(
      PayoutErrorCode.NOT_APPROVED,
      "Falta la aprobación humana antes de mover wARS",
    );
  }

  const lines = input.lines.filter((line) => line.amount > 0n);
  if (lines.length === 0) {
    throw new PayoutError(PayoutErrorCode.NOTHING_TO_PAY, "No hay fichitas para repartir");
  }

  const transfers = lines.map((line) => prepareWarsTransfer(line.recipient, line.amount));

  if (input.dryRun) {
    return {
      dryRun: true,
      attributionCode: comunyfiAttributionCode(),
      transfers,
      hashes: [],
    };
  }

  for (const transfer of transfers) {
    if (isPlaceholderRecipient(transfer.recipient)) {
      throw new PayoutError(
        PayoutErrorCode.PLACEHOLDER_RECIPIENT,
        `Reemplazá el destinatario de relleno ${transfer.recipient} antes de un pago real`,
      );
    }
  }

  if (!input.sender) {
    throw new PayoutError(
      PayoutErrorCode.MISSING_SIGNER,
      "Falta AGENT_PRIVATE_KEY para enviar el pago",
    );
  }

  const hashes: Hash[] = [];
  for (const transfer of transfers) {
    const hash = await input.sender.send(toSendable(transfer));
    hashes.push(hash);
    input.onSent?.(hash, transfer);
  }

  return {
    dryRun: false,
    attributionCode: comunyfiAttributionCode(),
    transfers,
    hashes,
  };
}

export function createPayoutSender(options: { rpcUrl: string; privateKey: Hex }): PayoutSender {
  const account = privateKeyToAccount(options.privateKey);
  const wallet = createWalletClient({
    account,
    chain: celoChain,
    transport: http(options.rpcUrl),
  });

  return {
    async send(tx) {
      if (tx.chainId !== CELO_CHAIN_ID) {
        throw new PayoutError(PayoutErrorCode.WRONG_CHAIN, "El pago solo sale en Celo mainnet");
      }
      return wallet.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value,
        chain: celoChain,
      });
    },
  };
}
