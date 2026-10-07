import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { getAddress } from "viem";
import { wrapDurableSql, type SyncSql } from "../src/store/durable-sql.js";
import { wrapNodeSqlite } from "../src/store/db.js";
import { SCHEMA } from "../src/store/schema.js";
import { ROOM_NAME, forwardToRoom } from "../src/worker/forward.js";
import { loadWorkerConfig, openWorkerRoom } from "../src/worker/room.js";
import { sessionFromDb } from "../src/voting/session.js";

const SECRET = "webhook-test";
const SETUP = "setup-test";

function botInfo() {
  return {
    id: 99,
    is_bot: true as const,
    first_name: "Comunyfi",
    username: "comunyfi_bot",
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };
}

function commandUpdate(updateId: number, userId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_700_000_000,
      chat: { id: userId, type: "private", first_name: "Orga" },
      from: { id: userId, is_bot: false, first_name: "Orga" },
      text,
      entities: [{ offset: 0, length: text.split(/\s+/, 1)[0]?.length ?? text.length, type: "bot_command" }],
    },
  };
}

function sqliteAsSyncSql(db: DatabaseSync): SyncSql {
  return {
    exec(query, ...bindings) {
      const trimmed = query.trim();
      const statement = db.prepare(trimmed);
      if (/^(select|with)\b/i.test(trimmed)) {
        const rows = statement.all(...(bindings as never[])) as Record<string, unknown>[];
        return { rowsWritten: 0, toArray: () => rows };
      }
      const result = statement.run(...(bindings as never[]));
      return { rowsWritten: Number(result.changes), toArray: () => [] };
    },
  };
}

test("el adaptador síncrono corre la sesión contra el mismo SQL", () => {
  const raw = new DatabaseSync(":memory:");
  const db = wrapDurableSql(sqliteAsSyncSql(raw));
  db.exec(SCHEMA);
  const session = sessionFromDb(db, {
    poolAmount: 100n,
    fichitasPerAttendee: 100,
    maxFichitasPerProject: 40,
  });
  session.ensureRound("ensayo", { status: "open" });
  const recipient = getAddress("0x1111111111111111111111111111111111111111");
  session.addProject({ id: "agua", name: "Agua", summary: "Cisternas", recipient });
  session.updateProject({ id: "agua", name: "Agua nueva", summary: "Cisternas", recipient });
  assert.equal(session.listProjects()[0]?.name, "Agua nueva");
  assert.throws(() => session.updateProject({ id: "no", name: "No", summary: "No", recipient }), /no está/);
  raw.close();
});

test("el worker manda todo al mismo Durable Object", async () => {
  const names: string[] = [];
  const response = await forwardToRoom(new Request("https://comunyfi.test/health"), {
    idFromName(name) {
      names.push(name);
      return name;
    },
    get(id) {
      return {
        fetch(request) {
          return Promise.resolve(new Response(`${String(id)}:${new URL(request.url).pathname}`));
        },
      };
    },
  });
  assert.deepEqual(names, [ROOM_NAME]);
  assert.equal(await response.text(), "comunyfi:/health");
});

test("el dry-run es el default y el webhook reparte el tablero", async () => {
  assert.equal(loadWorkerConfig({}).dryRun, true);
  assert.equal(loadWorkerConfig({ PAYOUT_DRY_RUN: "false" }).dryRun, false);

  const room = openWorkerRoom(
    {
      TELEGRAM_BOT_TOKEN: "123:test",
      WEBHOOK_SECRET: SECRET,
      SETUP_SECRET: SETUP,
      ADMIN_TELEGRAM_IDS: "7",
      WEBHOOK_URL: "https://comunyfi.example.workers.dev",
    },
    wrapNodeSqlite(new DatabaseSync(":memory:")),
  );
  assert.equal(room.dryRun, true);
  assert.ok(room.bot);
  room.bot.botInfo = botInfo();

  const sent: string[] = [];
  let webhookUrl = "";
  room.bot.api.config.use(async (_prev, method, payload) => {
    const body = payload as { text?: string; url?: string; secret_token?: string };
    if (method === "sendMessage" && body.text) sent.push(body.text);
    if (method === "setWebhook") webhookUrl = body.url ?? "";
    return {
      ok: true as const,
      result:
        method === "setWebhook" || method === "setMyCommands"
          ? true
          : {
              message_id: 5,
              date: 1_700_000_000,
              chat: { id: 7, type: "private", first_name: "Orga" },
              text: body.text ?? "",
            },
    } as never;
  });

  const mismatch = await room.handle(
    new Request(`https://comunyfi.example.workers.dev/telegram/${SECRET}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "otro",
      },
      body: JSON.stringify(commandUpdate(1, 7, "/start")),
    }),
  );
  assert.equal(mismatch.status, 401);
  assert.equal(sent.length, 0);

  const wrongPath = await room.handle(
    new Request("https://comunyfi.example.workers.dev/telegram/otro", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
      body: JSON.stringify(commandUpdate(2, 7, "/start")),
    }),
  );
  assert.equal(wrongPath.status, 405);

  async function command(updateId: number, text: string): Promise<string> {
    const response = await room.handle(
      new Request(`https://comunyfi.example.workers.dev/telegram/${SECRET}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": SECRET,
        },
        body: JSON.stringify(commandUpdate(updateId, 7, text)),
      }),
    );
    assert.equal(response.status, 200);
    const body = await response.text();
    return `${sent.at(-1) ?? ""}\n${body}`;
  }

  assert.match(await command(3, "/abrir"), /votación está abierta/);
  room.session.registerAttendee({
    lumaGuestId: "gst-ana",
    email: "ana@jujuy.dev",
    telegramUserId: 10,
    displayName: "Ana",
  });
  room.session.setFichitas("gst-ana", "agua", 10);
  assert.match(await command(4, "/cerrar"), /votación está cerrada/);
  const preview = await command(5, "/aprobar");
  assert.match(preview, /No salió nada a Celo/);
  assert.match(preview, /celo_40ea7bdf091f/);
  assert.equal(room.session.votingStatus(), "closed");
  assert.equal(room.session.listProjects().length, 4);

  const page = await room.handle(new Request("https://comunyfi.example.workers.dev/"));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Agua en barrios altos/);
  const health = await room.handle(new Request("https://comunyfi.example.workers.dev/health"));
  assert.equal(await health.text(), "ok");
  const api = await room.handle(new Request("https://comunyfi.example.workers.dev/api/tablero"));
  const payload = (await api.json()) as { rows: Array<{ projectId: string }> };
  assert.equal(payload.rows.some((row) => row.projectId === "agua"), true);

  const denied = await room.handle(
    new Request("https://comunyfi.example.workers.dev/setup", {
      method: "POST",
      headers: { authorization: "Bearer no" },
    }),
  );
  assert.equal(denied.status, 401);
  assert.equal(webhookUrl, "");

  const setup = await room.handle(
    new Request("https://comunyfi.example.workers.dev/setup", {
      method: "POST",
      headers: { authorization: `Bearer ${SETUP}` },
    }),
  );
  assert.equal(setup.status, 200);
  const setupBody = await setup.text();
  assert.equal(setupBody.includes(SECRET), false);
  assert.equal(webhookUrl, `https://comunyfi.example.workers.dev/telegram/${SECRET}`);
});
