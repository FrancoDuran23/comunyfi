import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createClosedValidator } from "../src/luma/checkin.js";
import { createComunyfiBot } from "../src/telegram/bot.js";
import { startBoardServer } from "../src/projector/board.js";
import { createSession } from "../src/voting/session.js";

const SECRET = "camino-secreto";

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

function startUpdate() {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 1_700_000_000,
      chat: { id: 10, type: "private", first_name: "Ana" },
      from: { id: 10, is_bot: false, first_name: "Ana" },
      text: "/start",
      entities: [{ offset: 0, length: 6, type: "bot_command" }],
    },
  };
}

test("el webhook rechaza un secreto distinto y atiende un update válido", async () => {
  const session = createSession({
    poolAmount: 100n,
    fichitasPerAttendee: 100,
    maxFichitasPerProject: 40,
  });
  const bot = createComunyfiBot("123:test", {
    session,
    luma: createClosedValidator(),
    adminIds: new Set<number>(),
    dryRun: true,
    poolWallet: null,
  });
  bot.botInfo = botInfo();

  const sent: string[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    const body = payload as { text?: string };
    if (method === "sendMessage" && body.text) sent.push(body.text);
    return {
      ok: true as const,
      result: {
        message_id: 5,
        date: 1_700_000_000,
        chat: { id: 10, type: "private", first_name: "Ana" },
        text: body.text ?? "",
      },
    } as never;
  });

  const server = startBoardServer(session, 0, {
    webhook: { bot, pathSecret: SECRET, secretToken: SECRET },
  });
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const wrongHeader = await fetch(`${base}/telegram/${SECRET}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "otro",
      },
      body: JSON.stringify(startUpdate()),
    });
    assert.equal(wrongHeader.status, 401);
    assert.equal(sent.length, 0);

    const wrongPath = await fetch(`${base}/telegram/otro-secreto`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": SECRET,
      },
      body: JSON.stringify(startUpdate()),
    });
    assert.equal(wrongPath.status, 405);
    assert.equal(sent.length, 0);

    const ok = await fetch(`${base}/telegram/${SECRET}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": SECRET,
      },
      body: JSON.stringify(startUpdate()),
    });
    assert.equal(ok.status, 200);
    const reply = await ok.text();
    const handled = sent.some((text) => text.includes("Tu id de Telegram es 10")) || reply.includes("Tu id de Telegram es 10");
    assert.equal(handled, true);

    const page = await fetch(`${base}/health`);
    assert.equal(page.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
