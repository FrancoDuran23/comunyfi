import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { webhookCallback, type Bot } from "grammy";
import type { Session } from "../voting/session.js";
import { boardPayload, renderHtmlBoard } from "./view.js";

export { boardPayload, renderHtmlBoard, renderTextBoard, roundStatusLabel } from "./view.js";
export type { BoardPayload } from "./view.js";

export interface BoardWebhook {
  bot: Bot;
  pathSecret: string;
  secretToken: string;
}

export interface BoardServerOptions {
  /** Si está, se escucha solo en esa IP (alwaysdata). Si no, en todas las interfaces. */
  host?: string;
  webhook?: BoardWebhook;
}

export function startBoardServer(session: Session, port: number, options: BoardServerOptions = {}): Server {
  const webhook = options.webhook;
  const handleWebhook = webhook
    ? webhookCallback(webhook.bot, "http", { secretToken: webhook.secretToken })
    : null;
  const webhookPath = webhook ? `/telegram/${webhook.pathSecret}` : null;

  const server = createServer((req, res) => {
    void route(req, res).catch((error: unknown) => {
      console.error("Error en el tablero", error);
      if (res.headersSent) return;
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Error");
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (handleWebhook && webhookPath && req.method === "POST" && url.pathname === webhookPath) {
      await handleWebhook(req, res);
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      res.end("Método no permitido");
      return;
    }
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    if (url.pathname === "/api/tablero") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(boardPayload(session)));
      return;
    }
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderHtmlBoard(session));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("No está");
  }

  if (options.host) server.listen(port, options.host);
  else server.listen(port);
  return server;
}
