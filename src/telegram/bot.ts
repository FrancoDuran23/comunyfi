import "dotenv/config";
import { Bot } from "grammy";
import { pathToFileURL } from "node:url";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { handleCommand, type HandlerDeps } from "./handlers.js";

export function createComunyfiBot(token: string, deps: HandlerDeps): Bot {
  const bot = new Bot(token);

  bot.command(
    ["start", "ayuda", "vincular", "proyectos", "fichitas", "asignar", "tablero", "aprobar", "pagar"],
    async (ctx) => {
      const from = ctx.from;
      if (!from) return;
      const command = ctx.message?.text?.split(/\s+/, 1)[0]?.slice(1).split("@")[0] ?? "";
      const args = typeof ctx.match === "string" ? ctx.match : "";
      const text = await handleCommand(
        deps,
        { telegramUserId: from.id, displayName: from.first_name || "asistente" },
        command,
        args,
      );
      await ctx.reply(text);
    },
  );

  bot.catch((error) => {
    console.error("Error del bot de Telegram", error);
  });

  return bot;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(entry).href === import.meta.url;
}

export async function startTelegramBot(deps: HandlerDeps, token: string): Promise<void> {
  const bot = createComunyfiBot(token, deps);
  await bot.start();
}

if (isDirectRun()) {
  const config = loadConfig();
  if (!config.telegramBotToken) {
    console.error("Falta TELEGRAM_BOT_TOKEN. Mirá .env.example.");
    process.exitCode = 1;
  } else {
    const app = await createApp(config);
    console.log("Bot de Comunyfi escuchando. Dry-run:", config.dryRun);
    await startTelegramBot(app.handlers, config.telegramBotToken);
  }
}
