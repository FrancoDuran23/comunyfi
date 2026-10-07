import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import type { AppConfig } from "./config.js";
import {
  createClosedValidator,
  createGuestListValidator,
  createLumaApiValidator,
  type LumaValidator,
} from "./luma/checkin.js";
import { demoGuestsPath, loadGuestsFile } from "./luma/guests-file.js";
import { demoProjectsPath, loadProjectsFile } from "./projects.js";
import { openStoredSession, type Session } from "./voting/session.js";
import type { HandlerDeps } from "./telegram/handlers.js";
import { createCeloClient } from "./chain.js";
import { readPoolBalances } from "./wallet/balance.js";
import { createPayoutSender } from "./wallet/payout.js";

export interface ComunyfiApp {
  config: AppConfig;
  session: Session;
  handlers: HandlerDeps;
}

async function guestValidator(config: AppConfig): Promise<LumaValidator> {
  if (config.lumaApiKey) {
    return createLumaApiValidator({ eventId: config.lumaEventId, apiKey: config.lumaApiKey });
  }
  const file = config.lumaGuestsFile ?? (config.seedDemo ? demoGuestsPath() : null);
  if (!file) return createClosedValidator();
  const guests = await loadGuestsFile(file);
  return createGuestListValidator(config.lumaEventId, guests);
}

function poolWallet(config: AppConfig): Address | null {
  if (config.privateKey) return privateKeyToAccount(config.privateKey).address;
  return config.agentWallet;
}

export async function createApp(config: AppConfig): Promise<ComunyfiApp> {
  const session = openStoredSession(config.databasePath, {
    poolAmount: config.poolAmount,
    fichitasPerAttendee: config.fichitasPerAttendee,
    maxFichitasPerProject: config.maxFichitasPerProject,
  });

  const created = session.ensureRound("jujuy.dev");
  if (created) {
    const file = config.projectsFile ?? (config.seedDemo ? demoProjectsPath() : null);
    if (file) {
      const projects = await loadProjectsFile(file);
      for (const project of projects) session.addProject(project);
    }
  }

  const luma = await guestValidator(config);
  const sender =
    config.privateKey === null
      ? undefined
      : createPayoutSender({ rpcUrl: config.rpcUrl, privateKey: config.privateKey });
  const wallet = poolWallet(config);
  const client = wallet ? createCeloClient(config.rpcUrl) : null;

  return {
    config,
    session,
    handlers: {
      session,
      luma,
      adminIds: config.adminTelegramIds,
      dryRun: config.dryRun,
      poolWallet: wallet,
      ...(sender ? { sender } : {}),
      ...(client && wallet
        ? { readBalances: (address: Address) => readPoolBalances(address, client) }
        : {}),
    },
  };
}
