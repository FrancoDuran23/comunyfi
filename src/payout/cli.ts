import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CELO_CHAIN_ID, celoChain, DEFAULT_CELO_RPC_URL } from "../chain.js";
import { RUNNER_SECRET_HEADER } from "./constants.js";
import { dryRunFromEnv, feeCurrencyFromFlag, gasDropWei, runPayout, type ChainIo, type RunnerPlan } from "./runner.js";

export async function payoutFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const workerUrl = env.WORKER_URL?.trim().replace(/\/+$/, "") ?? "";
  const secret = env.PAYOUT_RUNNER_SECRET?.trim() ?? "";
  if (!workerUrl || !secret) {
    throw new Error("Faltan WORKER_URL y PAYOUT_RUNNER_SECRET");
  }
  const dryRun = dryRunFromEnv(env.PAYOUT_DRY_RUN);
  const feeCurrency = feeCurrencyFromFlag(env.PAYOUT_FEE_CURRENCY);
  const drop = gasDropWei(env.GAS_DROP_CELO, (env.GAS_DROP ?? "true").trim().toLowerCase() !== "false");
  const rpcUrl = env.CELO_RPC_URL?.trim() || DEFAULT_CELO_RPC_URL;
  const plan = await fetchPlan(workerUrl, secret);
  if (plan.lines.length === 0) {
    console.log("No hay destinatarios pendientes.");
    return;
  }
  const post = (body: Parameters<ChainIo["postResults"]>[0]) => postResults(workerUrl, secret, body);
  const outcome = await runPayout({
    dryRun,
    gasDropWei: drop,
    feeCurrency,
    expectedKey: env.PAYOUT_IDEMPOTENCY_KEY?.trim() || null,
    plan,
    io: dryRun ? dryIo(post) : chainIo(requireKey(env.AGENT_PRIVATE_KEY), rpcUrl, post),
  });
  console.log(
    outcome.dryRun ? `Ensayo. No se envió nada. Plan ${plan.idempotencyKey}.` : `Listo. ${outcome.sent} transferencias.`,
  );
}

function dryIo(post: ChainIo["postResults"]): ChainIo {
  return {
    async getNonce() {
      return 0;
    },
    async sendWars() {
      throw new Error("El ensayo no firma");
    },
    async sendCelo() {
      throw new Error("El ensayo no firma");
    },
    async wait() {},
    postResults: post,
  };
}

function requireKey(raw: string | undefined): Hex {
  const key = raw?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("AGENT_PRIVATE_KEY tiene que ser una clave hex de 32 bytes");
  }
  return key as Hex;
}

async function fetchPlan(workerUrl: string, secret: string): Promise<RunnerPlan> {
  const response = await fetch(`${workerUrl}/payout/plan`, {
    headers: { [RUNNER_SECRET_HEADER]: secret },
  });
  if (!response.ok) throw new Error(`No pude leer el plan (HTTP ${response.status})`);
  const body = (await response.json()) as {
    idempotencyKey?: string;
    roundId?: number;
    lines?: Array<{ projectId?: string; recipient?: string; amount?: string }>;
  };
  if (!body.idempotencyKey || !Array.isArray(body.lines) || typeof body.roundId !== "number") {
    throw new Error("El plan no tiene el formato esperado");
  }
  return {
    idempotencyKey: body.idempotencyKey,
    roundId: body.roundId,
    lines: body.lines.map((line) => {
      if (!line.projectId || !line.amount || !line.recipient || !isAddress(line.recipient)) {
        throw new Error("Destinatario inválido en el plan");
      }
      return { projectId: line.projectId, recipient: getAddress(line.recipient), amount: line.amount };
    }),
  };
}

async function postResults(workerUrl: string, secret: string, body: unknown): Promise<void> {
  const response = await fetch(`${workerUrl}/payout/results`, {
    method: "POST",
    headers: {
      [RUNNER_SECRET_HEADER]: secret,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`No pude publicar el resultado (HTTP ${response.status})`);
}

function chainIo(privateKey: Hex, rpcUrl: string, post: ChainIo["postResults"]): ChainIo {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: celoChain, transport: http(rpcUrl) });
  const client = createPublicClient({ chain: celoChain, transport: http(rpcUrl) });
  return {
    async getNonce() {
      return client.getTransactionCount({ address: account.address, blockTag: "pending" });
    },
    async sendWars(tx) {
      if (celoChain.id !== CELO_CHAIN_ID) throw new Error("Red distinta de Celo mainnet");
      return wallet.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: 0n,
        nonce: tx.nonce,
        chain: celoChain,
        ...(tx.feeCurrency ? { feeCurrency: tx.feeCurrency } : {}),
      });
    },
    async sendCelo(tx) {
      return wallet.sendTransaction({
        to: tx.to,
        value: tx.value,
        nonce: tx.nonce,
        chain: celoChain,
        ...(tx.feeCurrency ? { feeCurrency: tx.feeCurrency } : {}),
      });
    },
    async wait(hash: Hash) {
      await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
    },
    postResults: post,
  };
}
