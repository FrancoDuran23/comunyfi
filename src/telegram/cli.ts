import "dotenv/config";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { startTelegramBot } from "./bot.js";

const config = loadConfig();
if (!config.telegramBotToken) {
  console.error("Falta TELEGRAM_BOT_TOKEN. Mirá .env.example.");
  process.exitCode = 1;
} else {
  const app = await createApp(config);
  console.log("Bot de Comunyfi escuchando. Dry-run:", config.dryRun, "Luma:", app.handlers.luma.source);
  await startTelegramBot(app.handlers, config.telegramBotToken);
}
