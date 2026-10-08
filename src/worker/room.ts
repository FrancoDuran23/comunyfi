import { webhookCallback, type Bot } from "grammy";
import type { Address } from "viem";
import guests from "../../data/guests.example.json" with { type: "json" };
import projects from "../../data/projects.example.json" with { type: "json" };
import { createCeloClient } from "../chain.js";
import { loadConfig, type AppConfig } from "../config.js";
import { createGuestListValidator, createLumaApiValidator } from "../luma/checkin.js";
import { parseGuestsJson } from "../luma/guest-parse.js";
import { applyPayoutResults, parsePayoutResultBody } from "../payout/apply.js";
import { fallbackHint, PAYOUT_RESULT_WAIT_MS, RUNNER_SECRET_HEADER } from "../payout/constants.js";
import { dispatchPayoutWorkflow } from "../payout/dispatch.js";
import { parseProjects } from "../projects-data.js";
import { boardPayload, renderHtmlBoard } from "../projector/view.js";
import { SCHEMA } from "../store/schema.js";
import type { SqlDb } from "../store/sql.js";
import { createComunyfiBot, publishCommands } from "../telegram/bot.js";
import type { HandlerDeps } from "../telegram/handlers.js";
import { sessionFromDb, type Session } from "../voting/session.js";
import { readPoolBalances } from "../wallet/balance.js";

export interface WorkerBindings {
  TELEGRAM_BOT_TOKEN?: string;
  WEBHOOK_SECRET?: string;
  SETUP_SECRET?: string;
  ADMIN_TELEGRAM_IDS?: string;
  PAYOUT_DRY_RUN?: string;
  AGENT_WALLET?: string;
  PAYOUT_RUNNER_SECRET?: string;
  GITHUB_DISPATCH_TOKEN?: string;
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
  notifyStale(now: number): Promise<void>;
}

export interface RoomHost {
  setAlarm?(atMs: number): void;
  deleteAlarm?(): void;
  fetchImpl?: typeof fetch;
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
 * El Worker no firma: la primera firma en frío se pasa del límite de 10 ms.
 * Solo guarda AGENT_WALLET para leer el pozo.
 */
export function openWorkerRoom(env: WorkerBindings, db: SqlDb, host: RoomHost = {}): WorkerRoom {
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
  const wallet = config.agentWallet;
  const client = wallet ? createCeloClient(config.rpcUrl) : null;
  const dispatchToken = blankToNull(env.GITHUB_DISPATCH_TOKEN);
  const handlers: HandlerDeps = {
    session,
    luma,
    adminIds: config.adminTelegramIds,
    dryRun: config.dryRun,
    remotePayout: true,
    ...(!config.dryRun
      ? {
          payoutQueue: {
            async dispatch(idempotencyKey: string) {
              if (!dispatchToken) return { ok: false, status: 0 };
              return dispatchPayoutWorkflow({
                token: dispatchToken,
                idempotencyKey,
                ...(host.fetchImpl ? { fetchImpl: host.fetchImpl } : {}),
              });
            },
            armFallback(delayMs: number) {
              host.setAlarm?.(Date.now() + delayMs);
            },
          },
        }
      : {}),
    poolWallet: wallet,
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
  const runnerSecret = blankToNull(env.PAYOUT_RUNNER_SECRET);
  return {
    session,
    bot,
    dryRun: config.dryRun,
    handle: (request) => handleRoomRequest(request, room, runnerSecret),
    notifyStale: (now) => notifyStale(session, bot, host, now),
  };
}

export async function handleRoomRequest(
  request: Request,
  room: RoomContext,
  runnerSecret: string | null = null,
): Promise<Response> {
  const url = new URL(request.url);
  const secret = room.config.webhookSecret;
  if (url.pathname === "/payout/plan" && request.method === "GET") {
    return payoutPlan(room, request, runnerSecret);
  }
  if (url.pathname === "/payout/results" && request.method === "POST") {
    return payoutResults(room, request, runnerSecret);
  }
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

function authorizeRunner(request: Request, secret: string | null): boolean {
  if (!secret) return false;
  return safeEqual(request.headers.get(RUNNER_SECRET_HEADER) ?? "", secret);
}

function payoutPlan(room: RoomContext, request: Request, secret: string | null): Response {
  if (!secret) return text(503, "Falta PAYOUT_RUNNER_SECRET");
  if (!authorizeRunner(request, secret)) return text(401, "No autorizado");
  const plan = room.session.currentPayoutPlan();
  if (!plan) return text(404, "No hay un plan pendiente");
  const lines = plan.lines
    .filter((line) => line.txHash === null)
    .map((line) => ({
      projectId: line.projectId,
      recipient: line.recipient,
      amount: line.amount.toString(),
    }));
  return text(
    200,
    JSON.stringify({ idempotencyKey: plan.idempotencyKey, roundId: plan.roundId, lines }),
    "application/json; charset=utf-8",
  );
}

async function payoutResults(room: RoomContext, request: Request, secret: string | null): Promise<Response> {
  if (!secret) return text(503, "Falta PAYOUT_RUNNER_SECRET");
  if (!authorizeRunner(request, secret)) return text(401, "No autorizado");
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return text(400, "JSON inválido");
  }
  const body = parsePayoutResultBody(parsed);
  if (!body) return text(400, "El resultado no tiene el formato esperado");
  try {
    const outcome = await applyPayoutResults(room.session, notifyAdmin(room.bot), body);
    return text(200, JSON.stringify(outcome), "application/json; charset=utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    return text(409, message);
  }
}

function notifyAdmin(bot: Bot | null): (adminId: number, message: string) => Promise<void> {
  return async (adminId, message) => {
    if (!bot) return;
    await bot.api.sendMessage(adminId, message);
  };
}

async function notifyStale(session: Session, bot: Bot | null, host: RoomHost, now: number): Promise<void> {
  const plan = session.currentPayoutPlan();
  if (!plan || plan.fallbackNotified) return;
  if (plan.lines.every((line) => line.txHash)) {
    host.deleteAlarm?.();
    return;
  }
  if (now < plan.createdAt + PAYOUT_RESULT_WAIT_MS) return;
  await notifyAdmin(bot)(plan.adminTelegramId, `Pasaron 3 minutos y no llegó el resultado. ${fallbackHint()}`);
  session.markPayoutFallbackNotified(plan.idempotencyKey);
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
