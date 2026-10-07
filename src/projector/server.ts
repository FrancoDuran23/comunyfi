import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { startBoardServer } from "./board.js";

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(entry).href === import.meta.url;
}

if (isDirectRun()) {
  const config = loadConfig();
  const app = await createApp(config);
  startBoardServer(app.session, config.port);
  console.log(`Tablero de Comunyfi en http://127.0.0.1:${config.port}/`);
}
