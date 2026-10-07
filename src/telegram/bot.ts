import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";
import { pathToFileURL } from "node:url";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { handleCallback, handleCommand, handlePlainText, type BotReply, type HandlerDeps } from "./handlers.js";

const COMMANDS = [
  "start",
  "ayuda",
  "vincular",
  "proyectos",
  "fichitas",
  "resumen",
  "asignar",
  "tablero",
  "pozo",
  "admin",
  "ronda",
  "proyecto",
  "editar",
  "abrir",
  "cerrar",
  "resultados",
  "previsualizar",
  "aprobar",
] as const;

function keyboardOf(reply: BotReply): InlineKeyboard | undefined {
  if (!reply.buttons || reply.buttons.length === 0) return undefined;
  const keyboard = new InlineKeyboard();
  reply.buttons.forEach((row, rowIndex) => {
    if (rowIndex > 0) keyboard.row();
    for (const button of row) keyboard.text(button.text, button.data);
  });
  return keyboard;
}

async function sendReply(ctx: { reply: (text: string, extra?: object) => Promise<unknown> }, result: BotReply): Promise<void> {
  const keyboard = keyboardOf(result);
  await ctx.reply(result.text, keyboard ? { reply_markup: keyboard } : {});
}

export function createComunyfiBot(token: string, deps: HandlerDeps): Bot {
  const bot = new Bot(token);

  bot.command([...COMMANDS], async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const command = ctx.message?.text?.split(/\s+/, 1)[0]?.slice(1).split("@")[0] ?? "";
    const args = typeof ctx.match === "string" ? ctx.match : "";
    const result = await handleCommand(
      deps,
      { telegramUserId: from.id, displayName: from.first_name || "asistente" },
      command,
      args,
    );
    await sendReply(ctx, result);
  });

  bot.on("callback_query:data", async (ctx) => {
    const from = ctx.from;
    const result = await handleCallback(
      deps,
      { telegramUserId: from.id, displayName: from.first_name || "asistente" },
      ctx.callbackQuery.data,
    );
    await ctx.answerCallbackQuery();
    const keyboard = keyboardOf(result);
    const extra = keyboard ? { reply_markup: keyboard } : undefined;
    try {
      await ctx.editMessageText(result.text, extra);
    } catch {
      await ctx.reply(result.text, extra ?? {});
    }
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const from = ctx.from;
    if (!from) return;
    const actor = { telegramUserId: from.id, displayName: from.first_name || "asistente" };
    if (text.startsWith("/")) {
      const [raw = "", ...rest] = text.split(/\s+/);
      const name = raw.slice(1).split("@")[0] ?? "";
      if ((COMMANDS as readonly string[]).includes(name)) return;
      const result = await handleCommand(deps, actor, name, rest.join(" "));
      await sendReply(ctx, result);
      return;
    }
    const result = await handlePlainText(deps, actor, text);
    await sendReply(ctx, result);
  });

  bot.catch((error) => {
    console.error("Error del bot de Telegram", error);
  });

  return bot;
}

export async function publishCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Empezar y ver tu id" },
    { command: "proyectos", description: "Ver proyectos y asignar fichitas" },
    { command: "fichitas", description: "Tu resumen" },
    { command: "tablero", description: "Resultados" },
    { command: "pozo", description: "Saldo del pozo" },
    { command: "ayuda", description: "Ayuda" },
    { command: "admin", description: "Menú de la organización" },
    { command: "aprobar", description: "Pagar el pozo" },
  ]);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(entry).href === import.meta.url;
}

export async function startTelegramBot(deps: HandlerDeps, token: string): Promise<void> {
  const bot = createComunyfiBot(token, deps);
  try {
    await publishCommands(bot);
  } catch (error) {
    console.error("No pude publicar los comandos en Telegram", error);
  }
  await bot.start();
}

if (isDirectRun()) {
  const config = loadConfig();
  if (!config.telegramBotToken) {
    console.error("Falta TELEGRAM_BOT_TOKEN. Mirá .env.example.");
    process.exitCode = 1;
  } else {
    const app = await createApp(config);
    console.log("Bot de Comunyfi escuchando. Dry-run:", config.dryRun, "Luma:", app.handlers.luma.source);
    await startTelegramBot(app.handlers, config.telegramBotToken);
  }
}
