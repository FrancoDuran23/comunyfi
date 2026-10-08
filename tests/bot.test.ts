import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddress } from "viem";
import { Bot } from "grammy";
import { createGuestListValidator } from "../src/luma/checkin.js";
import { createComunyfiBot } from "../src/telegram/bot.js";
import { createSession } from "../src/voting/node-session.js";

interface Sent {
  method: string;
  text?: string;
  replyMarkup?: unknown;
}

function messageUpdate(updateId: number, userId: number, text: string, name = "Ana") {
  const command = text.startsWith("/") ? text.split(/\s+/, 1)[0] ?? text : "";
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_700_000_000,
      chat: { id: userId, type: "private" as const, first_name: name },
      from: { id: userId, is_bot: false, first_name: name },
      text,
      entities: text.startsWith("/")
        ? [{ offset: 0, length: command.length, type: "bot_command" as const }]
        : undefined,
    },
  };
}

function callbackUpdate(updateId: number, userId: number, data: string, name = "Ana") {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      from: { id: userId, is_bot: false, first_name: name },
      chat_instance: "instancia",
      data,
      message: {
        message_id: 5,
        date: 1_700_000_000,
        chat: { id: userId, type: "private" as const, first_name: name },
        text: "proyectos",
      },
    },
  };
}

test("grammY reparte fichitas sin hablar con Telegram", async () => {
  const session = createSession({
    poolAmount: 100n,
    fichitasPerAttendee: 100,
    maxFichitasPerProject: 40,
  });
  session.addProject({
    id: "agua",
    name: "Agua",
    summary: "Cisternas",
    recipient: getAddress("0x1111111111111111111111111111111111111111"),
  });
  const bot = createComunyfiBot("123:test", {
    session,
    luma: createGuestListValidator("jujuy-dev", [
      { email: "ana@jujuy.dev", name: "Ana", guestId: "gst-ana", checkedIn: true },
    ]),
    adminIds: new Set([1]),
    dryRun: true,
    poolWallet: null,
  });
  bot.botInfo = {
    id: 99,
    is_bot: true,
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

  const sent: Sent[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    const body = payload as { text?: string; reply_markup?: unknown };
    sent.push({ method, text: body.text, replyMarkup: body.reply_markup });
    const result =
      method === "answerCallbackQuery"
        ? true
        : {
            message_id: 5,
            date: 1_700_000_000,
            chat: { id: 10, type: "private", first_name: "Ana" },
            text: body.text ?? "",
          };
    return { ok: true as const, result } as never;
  });

  await bot.handleUpdate(messageUpdate(1, 10, "/start") as never);
  assert.match(sent.at(-1)?.text ?? "", /Tu id de Telegram es 10/);

  await bot.handleUpdate(messageUpdate(2, 10, "ana@jujuy.dev") as never);
  assert.match(sent.at(-1)?.text ?? "", /100 fichitas/);
  assert.ok(sent.at(-1)?.replyMarkup);

  await bot.handleUpdate(callbackUpdate(3, 10, "set:agua:30") as never);
  assert.equal(session.allocationOf("gst-ana", "agua"), 30);
  assert.match(sent.at(-1)?.text ?? "", /dejaste 30/);
  assert.ok(sent.some((entry) => entry.method === "answerCallbackQuery"));

  await bot.handleUpdate(messageUpdate(4, 11, "/aprobar", "Otra") as never);
  assert.match(sent.at(-1)?.text ?? "", /organización/);
});
