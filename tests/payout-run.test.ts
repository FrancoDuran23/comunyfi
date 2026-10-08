import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { getAddress, type Address, type Hash, type Hex } from "viem";
import { createClosedValidator } from "../src/luma/checkin.js";
import { applyPayoutResults } from "../src/payout/apply.js";
import { PAYOUT_RESULT_WAIT_MS, USDT_FEE_CURRENCY } from "../src/payout/constants.js";
import { dispatchPayoutWorkflow } from "../src/payout/dispatch.js";
import { feeCurrencyFromFlag, runPayout, type ChainIo, type RunnerPlan } from "../src/payout/runner.js";
import { assertCalldataHasAttribution } from "../src/payout/tag.js";
import { handleCommand, type HandlerDeps } from "../src/telegram/handlers.js";
import { wrapNodeSqlite } from "../src/store/db.js";
import { createSession } from "../src/voting/node-session.js";
import { openWorkerRoom } from "../src/worker/room.js";
import { prepareWarsTransfer } from "../src/wallet/payout.js";

const admin = { telegramUserId: 7, displayName: "Orga" };
const agua = getAddress("0x1111111111111111111111111111111111111111");
const oficio = getAddress("0x2222222222222222222222222222222222222222");
const placeholder = getAddress("0x0000000000000000000000000000000000000001");

function hash(byte: string): Hash {
  return `0x${byte.repeat(32)}` as Hash;
}

function closedSession() {
  const session = createSession({
    poolAmount: 100n,
    fichitasPerAttendee: 100,
    maxFichitasPerProject: 40,
  });
  session.addProject({ id: "agua", name: "Agua", summary: "Cisternas", recipient: agua });
  session.addProject({ id: "oficio", name: "Oficio", summary: "Becas", recipient: oficio });
  session.registerAttendee({
    lumaGuestId: "gst-ana",
    email: "ana@jujuy.dev",
    telegramUserId: 10,
    displayName: "Ana",
  });
  session.setFichitas("gst-ana", "agua", 10);
  session.setFichitas("gst-ana", "oficio", 5);
  session.closeVoting();
  return session;
}

function deps(session: ReturnType<typeof closedSession>, queue: HandlerDeps["payoutQueue"]): HandlerDeps {
  return {
    session,
    luma: createClosedValidator(),
    adminIds: new Set([7]),
    dryRun: false,
    remotePayout: true,
    poolWallet: null,
    ...(queue ? { payoutQueue: queue } : {}),
  };
}

test("el dispatch pega a GitHub y no manda el token en el cuerpo", async () => {
  const seen: Array<{ url: string; body: string; authorization: string }> = [];
  const result = await dispatchPayoutWorkflow({
    token: "gh-token-secreto",
    idempotencyKey: "r1-abc",
    fetchImpl: async (url, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: String(url),
        body: String(init?.body ?? ""),
        authorization: headers.get("authorization") ?? "",
      });
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(seen[0]?.url, "https://api.github.com/repos/FrancoDuran23/comunyfi/actions/workflows/payout.yml/dispatches");
  assert.equal(seen[0]?.authorization, "Bearer gh-token-secreto");
  const body = JSON.parse(seen[0]?.body ?? "{}") as { ref: string; inputs: { idempotency_key: string } };
  assert.equal(body.ref, "main");
  assert.equal(body.inputs.idempotency_key, "r1-abc");
  assert.equal(seen[0]?.body.includes("gh-token-secreto"), false);
});

test("/aprobar CONFIRMAR congela la ronda y responde pagando", async () => {
  const session = closedSession();
  const keys: string[] = [];
  const alarms: number[] = [];
  const app = deps(session, {
    async dispatch(idempotencyKey) {
      keys.push(idempotencyKey);
      return { ok: true, status: 204 };
    },
    armFallback(delayMs) {
      alarms.push(delayMs);
    },
  });
  const ask = await handleCommand(app, admin, "aprobar", "");
  assert.match(ask.text, /CONFIRMAR/);
  assert.equal(session.votingStatus(), "closed");

  const paying = await handleCommand(app, admin, "aprobar", "CONFIRMAR");
  assert.equal(paying.text, "Pagando…");
  assert.equal(session.votingStatus(), "paying");
  assert.equal(keys.length, 1);
  assert.equal(alarms[0], PAYOUT_RESULT_WAIT_MS);
  assert.throws(() => session.setFichitas("gst-ana", "agua", 1), /en curso/);

  const again = await handleCommand(app, admin, "aprobar", "");
  assert.equal(again.text, "Pagando…");
  assert.equal(keys[1], keys[0]);
});

test("si GitHub no acepta el workflow, el bot manda el fallback", async () => {
  const session = closedSession();
  const app = deps(session, {
    async dispatch() {
      return { ok: false, status: 404 };
    },
    armFallback() {
      throw new Error("no tenía que armar la alarma");
    },
  });
  await handleCommand(app, admin, "aprobar", "");
  const paying = await handleCommand(app, admin, "aprobar", "CONFIRMAR");
  assert.match(paying.text, /Pagando…/);
  assert.match(paying.text, /npm run payout/);
  assert.match(paying.text, /main/);
  assert.equal(session.currentPayoutPlan()?.fallbackNotified, true);
});

test("un destinatario de relleno no congela la ronda", async () => {
  const session = closedSession();
  session.addProject({ id: "relleno", name: "Relleno", summary: "No", recipient: placeholder });
  session.openVoting();
  session.setFichitas("gst-ana", "relleno", 1);
  session.closeVoting();
  const app = deps(session, {
    async dispatch() {
      throw new Error("no");
    },
    armFallback() {},
  });
  await handleCommand(app, admin, "aprobar", "");
  const reply = await handleCommand(app, admin, "aprobar", "CONFIRMAR");
  assert.match(reply.text, /relleno/i);
  assert.equal(session.votingStatus(), "closed");
});

test("el plan exige el secreto y el segundo cobro solo paga lo que falta", async () => {
  const room = openWorkerRoom(
    { PAYOUT_RUNNER_SECRET: "runner-secreto", TELEGRAM_BOT_TOKEN: "123:test" },
    wrapNodeSqlite(new DatabaseSync(":memory:")),
  );
  assert.ok(room.bot);
  const sent: string[] = [];
  room.bot.api.config.use(async (_prev, method, payload) => {
    const body = payload as { text?: string };
    if (method === "sendMessage" && body.text) sent.push(body.text);
    return { ok: true as const, result: true } as never;
  });
  room.session.openVoting();
  room.session.closeVoting();
  room.session.beginPayout();
  const plan = room.session.ensurePayoutPlan({
    roundId: 1,
    adminTelegramId: 7,
    createdAt: Date.now() - PAYOUT_RESULT_WAIT_MS - 1,
    lines: [
      { projectId: "agua", projectName: "Agua", recipient: agua, fichitas: 10, amount: 10n },
      { projectId: "oficio", projectName: "Oficio", recipient: oficio, fichitas: 5, amount: 5n },
    ],
  });

  const denied = await room.handle(new Request("https://comunyfi.test/payout/plan"));
  assert.equal(denied.status, 401);
  assert.equal((await denied.text()).includes("runner-secreto"), false);

  const wrong = await room.handle(
    new Request("https://comunyfi.test/payout/plan", { headers: { "x-payout-runner-secret": "otro" } }),
  );
  assert.equal(wrong.status, 401);

  const ok = await room.handle(
    new Request("https://comunyfi.test/payout/plan", { headers: { "x-payout-runner-secret": "runner-secreto" } }),
  );
  assert.equal(ok.status, 200);
  const first = (await ok.json()) as { lines: Array<{ recipient: string }>; idempotencyKey: string };
  assert.equal(first.lines.length, 2);
  assert.equal(first.idempotencyKey, plan.idempotencyKey);

  const post = (results: unknown) =>
    room.handle(
      new Request("https://comunyfi.test/payout/results", {
        method: "POST",
        headers: { "x-payout-runner-secret": "runner-secreto", "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: plan.idempotencyKey, dryRun: false, results }),
      }),
    );

  const applied = await post([{ recipient: agua, txHash: hash("ab") }]);
  assert.equal(applied.status, 200);
  assert.match(sent.at(-1) ?? "", /celoscan\.io\/tx\//);

  const again = await post([{ recipient: agua, txHash: hash("ab") }]);
  const againBody = (await again.json()) as { alreadyPaid: string[]; applied: string[] };
  assert.deepEqual(againBody.applied, []);
  assert.equal(againBody.alreadyPaid.length, 1);
  assert.equal(room.session.listLivePayouts().length, 1);

  const rest = await room.handle(
    new Request("https://comunyfi.test/payout/plan", { headers: { "x-payout-runner-secret": "runner-secreto" } }),
  );
  const remaining = (await rest.json()) as { lines: Array<{ recipient: string }> };
  assert.deepEqual(
    remaining.lines.map((line) => line.recipient),
    [oficio],
  );

  await post([{ recipient: oficio, txHash: hash("cd") }]);
  assert.equal(room.session.votingStatus(), "paid");
  const page = await room.handle(new Request("https://comunyfi.test/"));
  assert.match(await page.text(), /celoscan\.io\/tx\//);

  await room.notifyStale(Date.now());
  assert.equal(sent.some((text) => text.includes("3 minutos")), false);
});

test("a los 3 minutos sin hash el bot pide la laptop", async () => {
  const room = openWorkerRoom(
    { PAYOUT_RUNNER_SECRET: "runner-secreto", TELEGRAM_BOT_TOKEN: "123:test" },
    wrapNodeSqlite(new DatabaseSync(":memory:")),
  );
  assert.ok(room.bot);
  const sent: string[] = [];
  room.bot.api.config.use(async () => {
    return { ok: true as const, result: true } as never;
  });
  room.bot.api.config.use(async (_prev, method, payload) => {
    const body = payload as { text?: string };
    if (method === "sendMessage" && body.text) sent.push(body.text);
    return { ok: true as const, result: true } as never;
  });
  room.session.openVoting();
  room.session.closeVoting();
  room.session.beginPayout();
  room.session.ensurePayoutPlan({
    roundId: 1,
    adminTelegramId: 7,
    createdAt: Date.now() - PAYOUT_RESULT_WAIT_MS - 5,
    lines: [{ projectId: "agua", projectName: "Agua", recipient: agua, fichitas: 1, amount: 1n }],
  });
  await room.notifyStale(Date.now());
  assert.match(sent[0] ?? "", /npm run payout/);
  await room.notifyStale(Date.now());
  assert.equal(sent.length, 1);
});

test("el runner rechaza calldata sin etiqueta y en seco no firma", async () => {
  const prepared = prepareWarsTransfer(agua, 10n);
  assert.doesNotThrow(() => assertCalldataHasAttribution(prepared.data));
  const stripped = prepared.data.slice(0, 2 + 8 + 64 + 64) as Hex;
  assert.throws(() => assertCalldataHasAttribution(stripped), /etiqueta/);

  const plan: RunnerPlan = {
    idempotencyKey: "r1-test",
    roundId: 1,
    lines: [{ projectId: "agua", recipient: agua, amount: "10" }],
  };
  let sends = 0;
  let postedDry = false;
  const io: ChainIo = {
    async getNonce() {
      return 4;
    },
    async sendWars() {
      sends += 1;
      return hash("11");
    },
    async sendCelo() {
      return hash("22");
    },
    async wait() {},
    async postResults(body) {
      postedDry = body.dryRun;
    },
  };
  const dry = await runPayout({ dryRun: true, gasDropWei: 0n, feeCurrency: null, plan, io });
  assert.equal(dry.sent, 0);
  assert.equal(sends, 0);
  assert.equal(postedDry, true);

  const nonces: number[] = [];
  const fees: Array<Address | null> = [];
  const liveIo: ChainIo = {
    async getNonce() {
      return 4;
    },
    async sendWars(tx) {
      nonces.push(tx.nonce);
      fees.push(tx.feeCurrency);
      assertCalldataHasAttribution(tx.data);
      return hash("aa");
    },
    async sendCelo(tx) {
      nonces.push(tx.nonce);
      return hash("bb");
    },
    async wait() {},
    async postResults() {},
  };
  assert.equal(feeCurrencyFromFlag("usdt"), USDT_FEE_CURRENCY);
  assert.equal(feeCurrencyFromFlag(""), null);
  const live = await runPayout({
    dryRun: false,
    gasDropWei: 50_000_000_000_000_000n,
    feeCurrency: USDT_FEE_CURRENCY,
    plan,
    io: liveIo,
  });
  assert.equal(live.sent, 1);
  assert.deepEqual(nonces, [4, 5]);
  assert.equal(fees[0], USDT_FEE_CURRENCY);
});

test("un resultado repetido no duplica el pago", () => {
  const session = closedSession();
  session.beginPayout();
  const plan = session.ensurePayoutPlan({
    roundId: 1,
    adminTelegramId: 7,
    createdAt: 1,
    lines: [{ projectId: "agua", projectName: "Agua", recipient: agua, fichitas: 1, amount: 10n }],
  });
  const notes: string[] = [];
  const body = {
    idempotencyKey: plan.idempotencyKey,
    dryRun: false,
    results: [{ recipient: agua, txHash: hash("ee") }],
  };
  return applyPayoutResults(session, async (_id, text) => {
    notes.push(text);
  }, body).then(async (first) => {
    assert.equal(first.applied.length, 1);
    const second = await applyPayoutResults(session, async () => {
      throw new Error("no tenía que avisar de nuevo");
    }, body);
    assert.deepEqual(second.applied, []);
    assert.equal(second.alreadyPaid.length, 1);
    assert.equal(session.listLivePayouts().length, 1);
    assert.equal(notes.length, 1);
  });
});
