import { getAddress, isAddress, type Address, type Hash } from "viem";
import { fallbackHint } from "./constants.js";
import type { Session } from "../voting/session.js";
import { celoscanTxUrl } from "../wallet/payout.js";

export interface PayoutResultBody {
  idempotencyKey: string;
  dryRun: boolean;
  results: Array<{ recipient: Address; txHash?: Hash; celoTxHash?: Hash }>;
}

export function parsePayoutResultBody(value: unknown): PayoutResultBody | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { idempotencyKey?: unknown; dryRun?: unknown; results?: unknown };
  if (typeof body.idempotencyKey !== "string" || !Array.isArray(body.results)) return null;
  const results: PayoutResultBody["results"] = [];
  for (const entry of body.results) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as { recipient?: unknown; txHash?: unknown; celoTxHash?: unknown };
    if (typeof row.recipient !== "string" || !isAddress(row.recipient)) return null;
    const txHash = optionalHash(row.txHash);
    const celoTxHash = optionalHash(row.celoTxHash);
    if (txHash === undefined || celoTxHash === undefined) return null;
    results.push({
      recipient: getAddress(row.recipient),
      ...(txHash ? { txHash } : {}),
      ...(celoTxHash ? { celoTxHash } : {}),
    });
  }
  return { idempotencyKey: body.idempotencyKey, dryRun: body.dryRun === true, results };
}

function optionalHash(value: unknown): Hash | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) return undefined;
  return value as Hash;
}

export async function applyPayoutResults(
  session: Session,
  notify: (adminId: number, text: string) => Promise<void>,
  body: PayoutResultBody,
): Promise<{ applied: string[]; alreadyPaid: string[] }> {
  const plan = session.currentPayoutPlan();
  if (!plan || plan.idempotencyKey !== body.idempotencyKey) {
    throw new Error("Ese plan no está pendiente");
  }
  if (body.dryRun) {
    await notify(plan.adminTelegramId, `Ensayo del runner. No salió nada a Celo. ${fallbackHint()}`);
    return { applied: [], alreadyPaid: [] };
  }
  const applied: string[] = [];
  const alreadyPaid: string[] = [];
  for (const result of body.results) {
    const mark = session.markPayoutResult({
      idempotencyKey: body.idempotencyKey,
      recipient: result.recipient,
      txHash: result.txHash ?? null,
      celoTxHash: result.celoTxHash ?? null,
    });
    if (mark.alreadyPaid) alreadyPaid.push(result.recipient);
    else if (mark.updated && result.txHash) applied.push(result.txHash);
  }
  const current = session.currentPayoutPlan();
  if (current && current.lines.length > 0 && current.lines.every((line) => line.txHash)) {
    session.completePayout();
  }
  if (applied.length > 0) {
    const links = applied.map((hash) => celoscanTxUrl(hash as Hash)).join("\n");
    await notify(plan.adminTelegramId, `Listo, salieron estos pagos.\n${links}`);
  }
  return { applied, alreadyPaid };
}
