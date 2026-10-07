import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { codeFromRepo, fromDataSuffix } from "@celo/attribution-tags";
import { decodeFunctionData, erc20Abi, getAddress, type Hash } from "viem";
import { comunyfiAttributionCode } from "../src/attribution.js";
import { CELO_CHAIN_ID, WARS_TOKEN_ADDRESS } from "../src/chain.js";
import { createSession } from "../src/voting/session.js";
import {
  executePayout,
  isPlaceholderRecipient,
  prepareWarsTransfer,
  type PayoutSender,
} from "../src/wallet/payout.js";

const recipient = getAddress("0x1111111111111111111111111111111111111111");
const placeholder = getAddress("0x0000000000000000000000000000000000000001");

function expectedCode(repo: string): string {
  const hash = createHash("sha256").update(repo.trim().toLowerCase()).digest("hex");
  return `celo_${hash.slice(0, 12)}`;
}

test("la etiqueta sale del repo FrancoDuran23/comunyfi", () => {
  const code = expectedCode("FrancoDuran23/comunyfi");
  assert.equal(code, "celo_40ea7bdf091f");
  assert.equal(codeFromRepo("FrancoDuran23/comunyfi"), code);
  assert.equal(codeFromRepo("https://github.com/FrancoDuran23/comunyfi"), code);
  assert.equal(comunyfiAttributionCode(), code);
});

test("el transfer de wARS lleva el sufijo y los argumentos del ERC-20", () => {
  const prepared = prepareWarsTransfer(recipient, 5n * 10n ** 18n);
  assert.equal(prepared.chainId, CELO_CHAIN_ID);
  assert.equal(prepared.chainId, 42220);
  assert.equal(prepared.token, getAddress(WARS_TOKEN_ADDRESS));
  assert.equal(prepared.attributionCode, "celo_40ea7bdf091f");
  assert.equal(prepared.data.startsWith("0xa9059cbb"), true);

  const callData = `0x${prepared.data.slice(2, 2 + 8 + 64 + 64)}` as const;
  const decoded = decodeFunctionData({ abi: erc20Abi, data: callData });
  assert.equal(decoded.functionName, "transfer");
  assert.deepEqual(decoded.args, [recipient, 5n * 10n ** 18n]);

  const tag = fromDataSuffix(prepared.data);
  assert.ok(tag);
  assert.equal(tag.codes.includes("celo_40ea7bdf091f"), true);
});

test("dry-run no envía y un pago real exige aprobación y destinatario de verdad", async () => {
  const calls: unknown[] = [];
  const sender: PayoutSender = {
    async send(tx) {
      calls.push(tx);
      return `0x${"ab".repeat(32)}` as Hash;
    },
  };
  const line = {
    projectId: "agua",
    projectName: "Agua",
    recipient,
    fichitas: 1,
    amount: 10n,
  };

  await assert.rejects(
    () => executePayout({ lines: [line], approved: false, dryRun: false, sender }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "NOT_APPROVED",
  );
  assert.equal(calls.length, 0);

  const dry = await executePayout({ lines: [line], approved: true, dryRun: true, sender });
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.hashes, []);
  assert.equal(calls.length, 0);
  assert.equal(dry.transfers.length, 1);
  assert.equal(dry.attributionCode, "celo_40ea7bdf091f");

  const live = await executePayout({ lines: [line], approved: true, dryRun: false, sender });
  assert.equal(live.dryRun, false);
  assert.equal(calls.length, 1);
  assert.equal(live.hashes.length, 1);
  const sent = calls[0] as { to: string; chainId: number; value: bigint; data: string };
  assert.equal(sent.to, getAddress(WARS_TOKEN_ADDRESS));
  assert.equal(sent.chainId, 42220);
  assert.equal(sent.value, 0n);
  assert.equal(fromDataSuffix(sent.data as `0x${string}`)?.codes.includes("celo_40ea7bdf091f"), true);

  assert.equal(isPlaceholderRecipient(placeholder), true);
  await assert.rejects(
    () =>
      executePayout({
        lines: [{ ...line, recipient: placeholder }],
        approved: true,
        dryRun: false,
        sender,
      }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PLACEHOLDER_RECIPIENT",
  );
  assert.equal(calls.length, 1);
});

test("el plan aprobado de la sesión se puede previsualizar sin firmar", async () => {
  const session = createSession({
    poolAmount: 100n,
    fichitasPerAttendee: 10,
    maxFichitasPerProject: 10,
  });
  session.addProject({
    id: "agua",
    name: "Agua",
    summary: "Cisternas",
    recipient: placeholder,
  });
  session.registerAttendee({
    lumaGuestId: "guest_ana",
    email: "ana@jujuy.dev",
    telegramUserId: 1,
    displayName: "Ana",
  });
  session.setFichitas("guest_ana", "agua", 10);
  session.closeVoting();

  const outcome = await executePayout({
    lines: session.plan(),
    approved: true,
    dryRun: true,
  });
  assert.equal(outcome.transfers[0]?.amount, 100n);
  assert.equal(outcome.transfers[0]?.recipient, placeholder);
});
