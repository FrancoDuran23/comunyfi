import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddress, type Hash } from "viem";
import { handleCommand, type HandlerDeps } from "../src/telegram/handlers.js";
import { createLumaValidator } from "../src/luma/checkin.js";
import { createSession } from "../src/voting/session.js";
import { renderHtmlBoard, renderTextBoard, startBoardServer } from "../src/projector/board.js";
import type { PayoutSender } from "../src/wallet/payout.js";

function deps(dryRun: boolean, sender?: PayoutSender): HandlerDeps {
  const session = createSession({
    poolAmount: 100n,
    fichitasPerAttendee: 100,
    maxFichitasPerProject: 40,
  });
  session.addProject({
    id: "agua",
    name: "Agua <script>",
    summary: "Cisternas",
    recipient: getAddress("0x1111111111111111111111111111111111111111"),
  });
  session.addProject({
    id: "oficio",
    name: "Oficio",
    summary: "Becas",
    recipient: getAddress("0x2222222222222222222222222222222222222222"),
  });
  return {
    session,
    luma: createLumaValidator({ eventId: "jujuy-dev", allowPlaceholderPrefix: true }),
    eventId: "jujuy-dev",
    adminIds: new Set([1]),
    dryRun,
    ...(sender ? { sender } : {}),
  };
}

test("el bot vincula, asigna, muestra el tablero y paga en dry-run", async () => {
  const app = deps(true);
  const ana = { telegramUserId: 10, displayName: "Ana" };
  const orga = { telegramUserId: 1, displayName: "Orga" };

  const linked = await handleCommand(app, ana, "vincular", "guest_ana");
  assert.match(linked, /100 fichitas/);

  const again = await handleCommand(app, ana, "vincular", "guest_beto");
  assert.match(again, /ya está vinculado/);

  const assigned = await handleCommand(app, ana, "asignar", "agua 40");
  assert.match(assigned, /Te quedan 60/);
  assert.match(await handleCommand(app, ana, "asignar", "agua 1"), /Tope de 40/);

  const board = await handleCommand(app, ana, "tablero", "");
  assert.match(board, /Agua <script>/);
  assert.match(board, /40 fichitas/);

  const html = renderHtmlBoard(app.session);
  assert.match(html, /Agua &lt;script&gt;/);
  assert.equal(html.includes("<script>"), false);
  assert.match(renderTextBoard(app.session), /EN VOTACIÓN/);

  assert.match(await handleCommand(app, ana, "aprobar", ""), /Solo la organización/);
  assert.match(await handleCommand(app, ana, "pagar", ""), /Solo la organización/);
  assert.match(await handleCommand(app, orga, "pagar", ""), /Falta la aprobación/);

  const approved = await handleCommand(app, orga, "aprobar", "");
  assert.match(approved, /Pozo aprobado/);
  assert.match(renderTextBoard(app.session), /APROBADO/);

  const paid = await handleCommand(app, orga, "pagar", "");
  assert.match(paid, /Dry-run/);
  assert.match(paid, /celo_40ea7bdf091f/);
  assert.match(paid, /No se envió nada/);
});

test("el tablero responde html y json", async () => {
  const app = deps(true);
  await handleCommand(app, { telegramUserId: 10, displayName: "Ana" }, "vincular", "guest_ana");
  await handleCommand(app, { telegramUserId: 10, displayName: "Ana" }, "asignar", "oficio 25");

  const server = startBoardServer(app.session, 0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    const html = await page.text();
    assert.match(html, /Comunyfi/);
    assert.match(html, /Oficio/);
    assert.match(html, /25/);

    const api = await fetch(`${base}/api/tablero`);
    const body = (await api.json()) as { rows: Array<{ projectId: string; fichitas: number }>; approved: boolean };
    assert.equal(body.approved, false);
    assert.equal(body.rows.find((row) => row.projectId === "oficio")?.fichitas, 25);

    const health = await fetch(`${base}/health`);
    assert.equal(await health.text(), "ok");
    assert.equal((await fetch(`${base}/no-existe`)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("un pago en vivo usa el sender una vez por proyecto con fichitas", async () => {
  const hashes: Hash[] = [];
  const sender: PayoutSender = {
    async send() {
      const hash = `0x${(hashes.length + 1).toString(16).padStart(64, "0")}` as Hash;
      hashes.push(hash);
      return hash;
    },
  };
  const app = deps(false, sender);
  await handleCommand(app, { telegramUserId: 10, displayName: "Ana" }, "vincular", "guest_ana");
  await handleCommand(app, { telegramUserId: 10, displayName: "Ana" }, "asignar", "agua 40");
  await handleCommand(app, { telegramUserId: 10, displayName: "Ana" }, "asignar", "oficio 20");
  await handleCommand(app, { telegramUserId: 1, displayName: "Orga" }, "aprobar", "");
  const paid = await handleCommand(app, { telegramUserId: 1, displayName: "Orga" }, "pagar", "");
  assert.equal(hashes.length, 2);
  assert.match(paid, new RegExp(hashes[0] ?? ""));
  assert.match(paid, new RegExp(hashes[1] ?? ""));
});
