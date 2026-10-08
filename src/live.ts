import "dotenv/config";
import type { Server } from "node:http";
import { createApp } from "./app.js";
import { comunyfiAttributionCode } from "./attribution.js";
import { configSummary, loadConfig, type AppConfig } from "./config.js";
import { startBoardServer } from "./projector/board.js";
import { createComunyfiBot, publishCommands } from "./telegram/bot.js";

const config = loadConfig();
const app = await createApp(config);

const bot = config.telegramBotToken ? createComunyfiBot(config.telegramBotToken, app.handlers) : null;
const webhook = bot && config.webhookUrl && config.webhookSecret
  ? { bot, pathSecret: config.webhookSecret, secretToken: config.webhookSecret }
  : undefined;

const server = startBoardServer(app.session, config.port, {
  host: config.bindHost ?? undefined,
  webhook,
});
await onceListening(server);

console.log("Comunyfi en vivo");
console.log(JSON.stringify({ ...configSummary(config), attributionCode: comunyfiAttributionCode() }, null, 2));
console.log(listenLine(config));

if (!bot) {
  console.log("Sin TELEGRAM_BOT_TOKEN: el tablero queda arriba y el bot no arranca.");
} else if (config.webhookUrl && config.webhookSecret) {
  try {
    await publishCommands(bot);
  } catch (error) {
    console.error("No pude publicar los comandos en Telegram", error);
  }
  const url = `${config.webhookUrl}/telegram/${config.webhookSecret}`;
  await bot.api.setWebhook(url, { secret_token: config.webhookSecret });
  console.log("Modo webhook: Telegram pega a /telegram/<secreto>. Sin long polling.");
  const stop = () => {
    server.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} else {
  try {
    await publishCommands(bot);
  } catch (error) {
    console.error("No pude publicar los comandos en Telegram", error);
  }
  console.log("Modo long polling (desarrollo local).");
  const stop = async () => {
    server.close();
    await bot.stop();
  };
  process.once("SIGINT", () => {
    void stop();
  });
  process.once("SIGTERM", () => {
    void stop();
  });
  await bot.start();
}

function listenLine(current: AppConfig): string {
  if (current.bindHost) return `Escuchando en ${current.bindHost}:${current.port}`;
  return `Tablero en http://127.0.0.1:${current.port}/`;
}

function onceListening(current: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    current.once("listening", () => resolve());
    current.once("error", reject);
  });
}
