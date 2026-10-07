import "dotenv/config";
import { createApp } from "./app.js";
import { comunyfiAttributionCode } from "./attribution.js";
import { configSummary, loadConfig } from "./config.js";
import { startBoardServer } from "./projector/board.js";
import { createComunyfiBot } from "./telegram/bot.js";

const config = loadConfig();
const app = await createApp(config);

const server = startBoardServer(app.session, config.port);
console.log("Comunyfi en vivo");
console.log(JSON.stringify({ ...configSummary(config), attributionCode: comunyfiAttributionCode() }, null, 2));
console.log(`Tablero en http://127.0.0.1:${config.port}/`);

if (!config.telegramBotToken) {
  console.log("Sin TELEGRAM_BOT_TOKEN: el tablero queda arriba y el bot no arranca.");
} else {
  const bot = createComunyfiBot(config.telegramBotToken, app.handlers);
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
