import { webhookCallback, type Bot } from "grammy";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import guests from "../../data/guests.example.json" with { type: "json" };
import projects from "../../data/projects.example.json" with { type: "json" };
import { createCeloClient } from "../chain.js";
import { loadConfig, type AppConfig } from "../config.js";
import { createGuestListValidator, createLumaApiValidator } from "../luma/checkin.js";
import { parseGuestsJson } from "../luma/guest-parse.js";
import { parseProjects } from "../projects-data.js";
import { boardPayload, renderHtmlBoard } from "../projector/view.js";
import { SCHEMA } from "../store/schema.js";
import type { SqlDb } from "../store/sql.js";
import { createComunyfiBot, publishCommands } from "../telegram/bot.js";
import type { HandlerDeps } from "../telegram/handlers.js";
import { sessionFromDb, type Session } from "../voting/session.js";
import { readPoolBalances } from "../wallet/balance.js";
import { createPayoutSender } from "../wallet/payout.js";

export interface WorkerBindings {
  TELEGRAM_BOT_TOKEN?: string;
  WEBHOOK_SECRET?: string;
  SETUP_SECRET?: string;
  ADMIN_TELEGRAM_IDS?: string;
  PAYOUT_DRY_RUN?: string;
  AGENT_PRIVATE_KEY?: string;
  AGENT_WALLET?: string;
  LUMA_API_KEY?: string;
  LUMA_EVENT_ID?: string;
  WEBHOOK_URL?: string;
  CELO_RPC_URL?: string;
  POOL_AMOUNT_WARS?: string;
  FICHITAS_PER_ATTENDEE?: string;
  MAX_FICHITAS_PER_PROJECT?: string;
}

export interface WorkerRoom {
  handle(request: Request): Promise<Response>;
  session: Session;
  bot: Bot | null;
  dryRun: boolean;
}

interface RoomContext {
  config: AppConfig;
  session: Session;
  bot: Bot | null;
  webhook: ((request: Request) => Promise<Response>) | null;
  setupSecret: string | null;
}

export function loadWorkerConfig(env: WorkerBindings): AppConfig {
  return loadConfig({
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
    WEBHOOK_SECRET: env.WEBHOOK_SECRET,
    ADMIN_TELEGRAM_IDS: env.ADMIN_TELEGRAM_IDS,
    PAYOUT_DRY_RUN: env.PAYOUT_DRY_RUN,
    AGENT_PRIVATE_KEY: env.AGENT_PRIVATE_KEY,
    AGENT_WALLET: env.AGENT_WALLET,
    LUMA_API_KEY: env.LUMA_API_KEY,
    LUMA_EVENT_ID: env.LUMA_EVENT_ID,
    WEBHOOK_URL: env.WEBHOOK_URL,
    CELO_RPC_URL: env.CELO_RPC_URL,
    POOL_AMOUNT_WARS: env.POOL_AMOUNT_WARS,
    FICHITAS_PER_ATTENDEE: env.FICHITAS_PER_ATTENDEE,
    MAX_FICHITAS_PER_PROJECT: env.MAX_FICHITAS_PER_PROJECT,
    DATABASE_PATH: ":memory:",
    SEED_DEMO: "false",
  });
}

/**
 * Arma la ronda sobre un SQL síncrono (node:sqlite o ctx.storage.sql).
 * El pago en vivo firma con viem dentro del request: en el plan Free el CPU
 * es de 10 ms y varias firmas pueden pasarse. El dry-run solo arma el calldata.
 */
export function openWorkerRoom(env: WorkerBindings, db: SqlDb): WorkerRoom {
  db.exec(SCHEMA);
  const config = loadWorkerConfig(env);
  const session = sessionFromDb(db, {
    poolAmount: config.poolAmount,
    fichitasPerAttendee: config.fichitasPerAttendee,
    maxFichitasPerProject: config.maxFichitasPerProject,
  });
  if (session.ensureRound("jujuy.dev")) {
    for (const project of parseProjects(projects)) session.addProject(project);
  }

  const luma = config.lumaApiKey
    ? createLumaApiValidator({ eventId: config.lumaEventId, apiKey: config.lumaApiKey })
    : createGuestListValidator(config.lumaEventId, parseGuestsJson(JSON.stringify(guests)));
  const wallet = config.privateKey ? privateKeyToAccount(config.privateKey).address : config.agentWallet;
  const sender = config.privateKey
    ? createPayoutSender({ rpcUrl: config.rpcUrl, privateKey: config.privateKey })
    : undefined;
  const client = wallet ? createCeloClient(config.rpcUrl) : null;
  const handlers: HandlerDeps = {
    session,
    luma,
    adminIds: config.adminTelegramIds,
    dryRun: config.dryRun,
    poolWallet: wallet,
    ...(sender ? { sender } : {}),
    ...(client && wallet ? { readBalances: (address: Address) => readPoolBalances(address, client) } : {}),
  };
  const bot = config.telegramBotToken ? createComunyfiBot(config.telegramBotToken, handlers) : null;
  const webhook =
    bot && config.webhookSecret
      ? webhookCallback(bot, "cloudflare-mod", { secretToken: config.webhookSecret })
      : null;
  const room: RoomContext = {
    config,
    session,
    bot,
    webhook,
    setupSecret: blankToNull(env.SETUP_SECRET),
  };
  return {
    session,
    bot,
    dryRun: config.dryRun,
    handle: (request) => handleRoomRequest(request, room),
  };
}

export async function handleRoomRequest(request: Request, room: RoomContext): Promise<Response> {
  const url = new URL(request.url);
  const secret = room.config.webhookSecret;
  if (request.method === "POST" && secret && url.pathname === `/telegram/${secret}`) {
    if (!room.webhook) return text(503, "Falta TELEGRAM_BOT_TOKEN");
    return room.webhook(request);
  }
  if (request.method === "POST" && url.pathname === "/setup") {
    return handleSetup(request, room);
  }
  if (request.method !== "GET") return text(405, "Método no permitido");
  if (url.pathname === "/health") return text(200, "ok");
  if (url.pathname === "/api/tablero") {
    return text(200, JSON.stringify(boardPayload(room.session)), "application/json; charset=utf-8");
  }
  if (url.pathname === "/") {
    return text(200, renderHtmlBoard(room.session), "text/html; charset=utf-8");
  }
  return text(404, "No está");
}

async function handleSetup(request: Request, room: RoomContext): Promise<Response> {
  if (!room.setupSecret) return text(503, "Falta SETUP_SECRET");
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!safeEqual(provided, room.setupSecret)) return text(401, "No autorizado");
  if (!room.bot || !room.config.webhookSecret) {
    return text(503, "Faltan TELEGRAM_BOT_TOKEN o WEBHOOK_SECRET");
  }
  const origin = (room.config.webhookUrl ?? new URL(request.url).origin).replace(/\/+$/, "");
  const webhookUrl = `${origin}/telegram/${room.config.webhookSecret}`;
  try {
    await publishCommands(room.bot);
    await room.bot.api.setWebhook(webhookUrl, { secret_token: room.config.webhookSecret });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de Telegram";
    return text(502, message);
  }
  return text(200, `Listo. Webhook registrado en ${origin}/telegram/<secreto> y comandos publicados.`);
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function text(status: number, body: string, contentType = "text/plain; charset=utf-8"): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
