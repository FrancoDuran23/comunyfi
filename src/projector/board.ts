import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { webhookCallback, type Bot } from "grammy";
import { formatWars } from "../format.js";
import type { Session } from "../voting/session.js";
import type { RoundStatus } from "../voting/types.js";

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

export function roundStatusLabel(status: RoundStatus | null): string {
  switch (status) {
    case "draft":
      return "Armando la ronda";
    case "open":
      return "Votación abierta";
    case "closed":
      return "Votación cerrada";
    case "paid":
      return "Pozo pagado";
    default:
      return "Sin ronda";
  }
}

export interface BoardPayload {
  title: string;
  status: RoundStatus | null;
  statusLabel: string;
  approved: boolean;
  attendees: number;
  pool: string;
  rows: Array<{
    projectId: string;
    projectName: string;
    summary: string;
    fichitas: number;
    amount: string;
    amountWei: string;
  }>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function boardPayload(session: Session): BoardPayload {
  const status = session.votingStatus();
  return {
    title: "Comunyfi · jujuy.dev",
    status,
    statusLabel: roundStatusLabel(status),
    approved: session.isApproved(),
    attendees: session.listAttendees().length,
    pool: formatWars(session.config.poolAmount),
    rows: session.standings().map((row) => ({
      projectId: row.projectId,
      projectName: row.projectName,
      summary: row.summary,
      fichitas: row.fichitas,
      amount: formatWars(row.amount),
      amountWei: row.amount.toString(),
    })),
  };
}

export function renderTextBoard(session: Session): string {
  const payload = boardPayload(session);
  const header = payload.statusLabel.toUpperCase();
  const lines = [
    `Comunyfi · ${header}`,
    `Pozo ${payload.pool} · ${payload.attendees} asistentes`,
    "",
  ];
  if (payload.rows.length === 0) {
    lines.push("Todavía no hay proyectos en la ronda.");
  }
  for (const row of payload.rows) {
    lines.push(`${row.projectName} (${row.projectId})`);
    lines.push(`  ${row.fichitas} fichitas · ${row.amount}`);
  }
  return lines.join("\n");
}

function rowHtml(row: BoardPayload["rows"][number], maxFichitas: number): string {
  const width = maxFichitas === 0 ? 0 : Math.round((row.fichitas / maxFichitas) * 100);
  return `<article class="card">
      <h2>${escapeHtml(row.projectName)}</h2>
      <p>${escapeHtml(row.summary)}</p>
      <div class="bar"><span style="width:${width}%"></span></div>
      <p class="score"><strong>${row.fichitas}</strong> fichitas · ${escapeHtml(row.amount)}</p>
    </article>`;
}

export function renderHtmlBoard(session: Session): string {
  const payload = boardPayload(session);
  const maxFichitas = payload.rows.reduce((max, row) => Math.max(max, row.fichitas), 0);
  const cards = payload.rows.map((row) => rowHtml(row, maxFichitas)).join("\n");
  const status = payload.statusLabel;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="3">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(payload.title)}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: Georgia, "Iowan Old Style", serif; background: #1c1915; color: #f6f1e7; }
    header { padding: 2.2rem 2.5rem 1rem; }
    h1 { font-size: 3rem; margin: 0 0 0.4rem; letter-spacing: -0.03em; }
    .meta { font-family: ui-sans-serif, system-ui, sans-serif; color: #d8c7a1; font-size: 1.25rem; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; padding: 1rem 2.5rem 2.5rem; }
    .card { background: #2a241c; border-radius: 18px; padding: 1.2rem 1.3rem 1.4rem; }
    h2 { margin: 0 0 0.4rem; font-size: 1.7rem; }
    p { margin: 0.3rem 0; line-height: 1.35; }
    .bar { margin-top: 1rem; height: 14px; background: #3d3428; border-radius: 999px; overflow: hidden; }
    .bar span { display: block; height: 100%; background: #e2b15a; }
    .score { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 1.15rem; }
  </style>
</head>
<body>
  <header>
    <h1>Comunyfi</h1>
    <p class="meta">${escapeHtml(status)} · pozo ${escapeHtml(payload.pool)} · ${payload.attendees} asistentes</p>
  </header>
  <main>
    ${cards || "<p>Todavía no hay proyectos en la ronda.</p>"}
  </main>
</body>
</html>`;
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
