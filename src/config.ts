import { join } from "node:path";
import { getAddress, isAddress, isHex, parseUnits, type Address, type Hex } from "viem";
import { ATTRIBUTION_REPO } from "./attribution.js";
import { packageRoot } from "./paths.js";
import {
  CELO_CHAIN_ID,
  DEFAULT_CELO_RPC_URL,
  WARS_DECIMALS,
  WARS_TOKEN_ADDRESS,
} from "./chain.js";

export interface AppConfig {
  chainId: typeof CELO_CHAIN_ID;
  rpcUrl: string;
  warsToken: Address;
  attributionRepo: typeof ATTRIBUTION_REPO;
  poolAmount: bigint;
  fichitasPerAttendee: number;
  maxFichitasPerProject: number;
  dryRun: boolean;
  privateKey: Hex | null;
  telegramBotToken: string | null;
  adminTelegramIds: ReadonlySet<number>;
  lumaEventId: string;
  lumaApiKey: string | null;
  lumaGuestsFile: string | null;
  databasePath: string;
  agentWallet: Address | null;
  erc8004Registry: Address | null;
  erc8004AgentId: bigint | null;
  erc8004AgentWallet: Address | null;
  x402FacilitatorUrl: string;
  projectsFile: string | null;
  seedDemo: boolean;
  port: number;
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return fallback;
  if (trimmed === "true" || trimmed === "1") return true;
  if (trimmed === "false" || trimmed === "0") return false;
  throw new Error(`Booleano inválido: "${value}"`);
}

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} debe ser un entero positivo`);
  }
  return parsed;
}

function csv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parsePrivateKey(value: string | undefined): Hex | null {
  const raw = optional(value);
  if (!raw) return null;
  if (!isHex(raw) || raw.length !== 66) {
    throw new Error("AGENT_PRIVATE_KEY debe ser una clave hex de 32 bytes con prefijo 0x");
  }
  return raw;
}

function parseAddress(value: string | undefined, name: string): Address | null {
  const raw = optional(value);
  if (!raw) return null;
  if (!isAddress(raw)) throw new Error(`${name} no es una dirección`);
  return getAddress(raw);
}

function parseAgentId(value: string | undefined): bigint | null {
  const raw = optional(value);
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) throw new Error("ERC8004_AGENT_ID debe ser un entero");
  return BigInt(raw);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const chainIdRaw = optional(env.CELO_CHAIN_ID);
  if (chainIdRaw && chainIdRaw !== String(CELO_CHAIN_ID)) {
    throw new Error(`CELO_CHAIN_ID debe ser ${CELO_CHAIN_ID} (Celo mainnet)`);
  }

  const warsRaw = optional(env.WARS_TOKEN_ADDRESS) ?? WARS_TOKEN_ADDRESS;
  if (!isAddress(warsRaw) || getAddress(warsRaw) !== getAddress(WARS_TOKEN_ADDRESS)) {
    throw new Error(`WARS_TOKEN_ADDRESS debe ser ${WARS_TOKEN_ADDRESS}`);
  }

  const poolWhole = positiveInt(env.POOL_AMOUNT_WARS, 50_000, "POOL_AMOUNT_WARS");
  const fichitasPerAttendee = positiveInt(env.FICHITAS_PER_ATTENDEE, 100, "FICHITAS_PER_ATTENDEE");
  const maxFichitasPerProject = positiveInt(
    env.MAX_FICHITAS_PER_PROJECT,
    40,
    "MAX_FICHITAS_PER_PROJECT",
  );
  if (maxFichitasPerProject > fichitasPerAttendee) {
    throw new Error("MAX_FICHITAS_PER_PROJECT no puede superar FICHITAS_PER_ATTENDEE");
  }

  const adminTelegramIds = new Set<number>();
  for (const item of csv(env.ADMIN_TELEGRAM_IDS)) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`ADMIN_TELEGRAM_IDS contiene un id inválido: ${item}`);
    }
    adminTelegramIds.add(id);
  }

  return {
    chainId: CELO_CHAIN_ID,
    rpcUrl: optional(env.CELO_RPC_URL) ?? DEFAULT_CELO_RPC_URL,
    warsToken: getAddress(WARS_TOKEN_ADDRESS),
    attributionRepo: ATTRIBUTION_REPO,
    poolAmount: parseUnits(String(poolWhole), WARS_DECIMALS),
    fichitasPerAttendee,
    maxFichitasPerProject,
    dryRun: flag(env.PAYOUT_DRY_RUN, true),
    privateKey: parsePrivateKey(env.AGENT_PRIVATE_KEY),
    telegramBotToken: optional(env.TELEGRAM_BOT_TOKEN),
    adminTelegramIds,
    lumaEventId: optional(env.LUMA_EVENT_ID) ?? "jujuy-dev",
    lumaApiKey: optional(env.LUMA_API_KEY),
    lumaGuestsFile: optional(env.LUMA_GUESTS_FILE),
    databasePath: optional(env.DATABASE_PATH) ?? join(packageRoot(), "data", "comunyfi.sqlite"),
    agentWallet: parseAddress(env.AGENT_WALLET, "AGENT_WALLET"),
    erc8004Registry: parseAddress(env.ERC8004_REGISTRY_ADDRESS, "ERC8004_REGISTRY_ADDRESS"),
    erc8004AgentId: parseAgentId(env.ERC8004_AGENT_ID),
    erc8004AgentWallet: parseAddress(env.ERC8004_AGENT_WALLET, "ERC8004_AGENT_WALLET"),
    x402FacilitatorUrl: optional(env.X402_FACILITATOR_URL) ?? "https://api.x402.celo.org",
    projectsFile: optional(env.PROJECTS_FILE),
    seedDemo: flag(env.SEED_DEMO, true),
    port: positiveInt(env.PORT, 3000, "PORT"),
  };
}

/** Resumen seguro para logs: no incluye la clave ni el token del bot. */
export function configSummary(config: AppConfig): Record<string, string | number | boolean> {
  return {
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    warsToken: config.warsToken,
    attributionRepo: config.attributionRepo,
    dryRun: config.dryRun,
    signerConfigured: config.privateKey !== null,
    telegramConfigured: config.telegramBotToken !== null,
    lumaEventId: config.lumaEventId,
    lumaMode: config.lumaApiKey
      ? "api"
      : config.lumaGuestsFile
        ? "archivo"
        : config.seedDemo
          ? "archivo-demo"
          : "sin-configurar",
    databasePath: config.databasePath,
    port: config.port,
  };
}
