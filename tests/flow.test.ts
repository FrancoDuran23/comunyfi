import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddress, type Hash } from "viem";
import { createGuestListValidator } from "../src/luma/checkin.js";
import { handleCallback, handleCommand, handlePlainText, type HandlerDeps } from "../src/telegram/handlers.js";
import { createSession } from "../src/voting/session.js";
import { renderHtmlBoard, renderTextBoard, startBoardServer } from "../src/projector/board.js";
import type { PayoutSender } from "../src/wallet/payout.js";
import type { PoolBalances } from "../src/wallet/balance.js";

const wallet = getAddress("0xabcabcabcabcabcabcabcabcabcabcabcabcabca");

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
    luma: createGuestListValidator("jujuy-dev", [
      { email: "ana@jujuy.dev", name: "Ana Pérez", guestId: "gst-ana", checkedIn: true },
    ]),
    adminIds: new Set([1]),
    dryRun,
    poolWallet: wallet,
    readBalances: async (): Promise<PoolBalances> => ({ wars: 50_000n * 10n ** 18n, celo: 2n * 10n ** 17n }),
    ...(sender ? { sender } : {}),
  };
}

test("el asistente se vincula por mail, reparte con botones y ve su resumen", async () => {
  const app = deps(true);
  const ana = { telegramUserId: 10, displayName: "Ana" };
  const start = await handleCommand(app, ana, "start", "");
  assert.match(start.text, /mail/);
  assert.match(start.text, /Tu id de Telegram es 10/);

  const linked = await handlePlainText(app, ana, "ana@jujuy.dev");
  assert.match(linked.text, /100 fichitas/);
  assert.ok(linked.buttons?.some((row) => row.some((button) => button.data === "proj:agua")));

  const again = await handlePlainText(app, ana, "ana@jujuy.dev");
  assert.match(again.text, /Ya estás adentro/);

  const detail = await handleCallback(app, ana, "proj:agua");
  assert.match(detail.text, /reemplaza/);
  const assigned = await handleCallback(app, ana, "set:agua:40");
  assert.match(assigned.text, /dejaste 40/);
  assert.match(assigned.text, /Te quedan 60/);
  assert.match(await handleCallback(app, ana, "set:agua:41").then((reply) => reply.text), /tope/i);

  const moved = await handleCommand(app, ana, "asignar", "agua 20");
  assert.match(moved.text, /dejaste 20/);
  assert.equal(app.session.allocationOf("gst-ana", "agua"), 20);

  const summary = await handleCommand(app, ana, "fichitas", "");
  assert.match(summary.text, /ana@jujuy.dev/);
  assert.match(summary.text, /Agua <script>: 20/);

  const html = renderHtmlBoard(app.session);
  assert.match(html, /Agua &lt;script&gt;/);
  assert.equal(html.includes("<script>"), false);
  assert.match(renderTextBoard(app.session), /VOTACIÓN ABIERTA/);
  assert.match(html, /Votación abierta/);
});

test("la organización abre, cierra, previsualiza y aprueba en dry-run", async () => {
  const app = deps(true);
  const ana = { telegramUserId: 10, displayName: "Ana" };
  const orga = { telegramUserId: 1, displayName: "Orga" };

  assert.match((await handleCommand(app, ana, "aprobar", "")).text, /organización/);
  assert.match((await handleCommand(app, ana, "admin", "")).text, /organización/);

  await handlePlainText(app, ana, "ana@jujuy.dev");
  await handleCallback(app, ana, "set:oficio:25");
  app.session.closeVoting();

  const preview = await handleCommand(app, orga, "previsualizar", "");
  assert.match(preview.text, /No se envió nada/);
  assert.match(preview.text, /celo_40ea7bdf091f/);

  const paid = await handleCallback(app, orga, "admin:aprobar");
  assert.match(paid.text, /Ensayo de \/aprobar/);
  assert.match(paid.text, /No salió nada a Celo/);
  assert.equal(app.session.votingStatus(), "closed");

  const pozo = await handleCommand(app, ana, "pozo", "");
  assert.match(pozo.text, /50\.000 wARS/);
  assert.match(pozo.text, /0,2 CELO/);
});

test("el pago en vivo pide confirmación y publica Celoscan", async () => {
  const hashes: Hash[] = [];
  const sender: PayoutSender = {
    async send() {
      const hash = `0x${(hashes.length + 1).toString(16).padStart(64, "0")}` as Hash;
      hashes.push(hash);
      return hash;
    },
  };
  const app = deps(false, sender);
  const orga = { telegramUserId: 1, displayName: "Orga" };
  await handlePlainText(app, { telegramUserId: 10, displayName: "Ana" }, "ana@jujuy.dev");
  await handleCallback(app, { telegramUserId: 10, displayName: "Ana" }, "set:agua:40");
  await handleCommand(app, { telegramUserId: 10, displayName: "Ana" }, "asignar", "oficio 20");
  await handleCommand(app, orga, "cerrar", "");

  const ask = await handleCommand(app, orga, "aprobar", "");
  assert.match(ask.text, /CONFIRMAR/);
  assert.equal(hashes.length, 0);

  const paid = await handleCommand(app, orga, "aprobar", "CONFIRMAR");
  assert.equal(hashes.length, 2);
  assert.match(paid.text, /celoscan\.io\/tx\//);
  assert.match(paid.text, new RegExp(hashes[0] ?? "missing"));
  assert.equal(app.session.isApproved(), true);
  assert.match((await handleCommand(app, orga, "aprobar", "")).text, /ya se pagó/i);
});

test("el tablero responde html y json con el mismo estado", async () => {
  const app = deps(true);
  await handlePlainText(app, { telegramUserId: 10, displayName: "Ana" }, "ana@jujuy.dev");
  await handleCallback(app, { telegramUserId: 10, displayName: "Ana" }, "set:oficio:25");

  const server = startBoardServer(app.session, 0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Comunyfi/);
    assert.match(html, /Oficio/);
    assert.match(html, /25/);

    const api = await fetch(`${base}/api/tablero`);
    const body = (await api.json()) as {
      status: string;
      rows: Array<{ projectId: string; fichitas: number }>;
    };
    assert.equal(body.status, "open");
    assert.equal(body.rows.find((row) => row.projectId === "oficio")?.fichitas, 25);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("la organización carga un proyecto y la wallet queda guardada", async () => {
  const app = deps(true);
  const orga = { telegramUserId: 1, displayName: "Orga" };
  const created = await handleCommand(
    app,
    orga,
    "proyecto",
    "conectividad | Internet en el ramal | Enlace rural | 0x3333333333333333333333333333333333333333",
  );
  assert.match(created.text, /Cargué/);
  const edited = await handleCommand(
    app,
    orga,
    "editar",
    "conectividad | Internet | Enlace para escuelas | 0x4444444444444444444444444444444444444444",
  );
  assert.match(edited.text, /Actualicé/);
  const project = app.session.listProjects().find((item) => item.id === "conectividad");
  assert.equal(project?.recipient, getAddress("0x4444444444444444444444444444444444444444"));
});
