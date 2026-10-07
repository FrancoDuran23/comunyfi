import type { AppConfig } from "./config.js";
import { createLumaValidator } from "./luma/checkin.js";
import { demoProjectsPath, loadProjectsFile } from "./projects.js";
import { createSession, type Session } from "./voting/session.js";
import type { HandlerDeps } from "./telegram/handlers.js";
import { createPayoutSender } from "./wallet/payout.js";

export interface ComunyfiApp {
  config: AppConfig;
  session: Session;
  handlers: HandlerDeps;
}

export async function createApp(config: AppConfig): Promise<ComunyfiApp> {
  const session = createSession({
    poolAmount: config.poolAmount,
    fichitasPerAttendee: config.fichitasPerAttendee,
    maxFichitasPerProject: config.maxFichitasPerProject,
  });

  const file = config.projectsFile ?? (config.seedDemo ? demoProjectsPath() : null);
  if (file) {
    const projects = await loadProjectsFile(file);
    for (const project of projects) session.addProject(project);
  }

  const luma = createLumaValidator({
    eventId: config.lumaEventId,
    checkedInGuestIds: config.lumaCheckedInGuestIds,
    allowPlaceholderPrefix: config.lumaAllowPlaceholderPrefix,
  });

  const sender =
    config.privateKey === null
      ? undefined
      : createPayoutSender({ rpcUrl: config.rpcUrl, privateKey: config.privateKey });

  return {
    config,
    session,
    handlers: {
      session,
      luma,
      eventId: config.lumaEventId,
      adminIds: config.adminTelegramIds,
      dryRun: config.dryRun,
      ...(sender ? { sender } : {}),
    },
  };
}
