import { AllocationError } from "../voting/types.js";
import { claimFichitas } from "../voting/claim.js";
import type { Session } from "../voting/session.js";
import { LumaValidationError, type LumaValidator } from "../luma/checkin.js";
import { renderTextBoard } from "../projector/board.js";
import { executePayout, PayoutError, type PayoutSender } from "../wallet/payout.js";
import { formatWars } from "../format.js";

export interface Actor {
  telegramUserId: number;
  displayName: string;
}

export interface HandlerDeps {
  session: Session;
  luma: LumaValidator;
  eventId: string;
  adminIds: ReadonlySet<number>;
  dryRun: boolean;
  sender?: PayoutSender;
}

function isAdmin(deps: HandlerDeps, actor: Actor): boolean {
  return deps.adminIds.has(actor.telegramUserId);
}

function helpText(isOrganizer: boolean): string {
  const lines = [
    "Comunyfi reparte un pozo en wARS entre proyectos de jujuy.dev.",
    "Cada asistente con check-in en Luma recibe fichitas y las asigna.",
    "",
    "/vincular <id de Luma>",
    "/proyectos",
    "/fichitas",
    "/asignar <proyecto> <cantidad>",
    "/tablero",
  ];
  if (isOrganizer) {
    lines.push("/aprobar", "/pagar");
  }
  return lines.join("\n");
}

async function vincular(deps: HandlerDeps, actor: Actor, args: string): Promise<string> {
  const guestId = args.trim();
  if (guestId.length === 0) {
    return "Pasame el id de invitado de Luma. Ejemplo: /vincular guest_ana";
  }
  try {
    const attendee = await claimFichitas({
      session: deps.session,
      luma: deps.luma,
      eventId: deps.eventId,
      guestId,
      telegramUserId: actor.telegramUserId,
      displayName: actor.displayName,
    });
    return `Listo, ${attendee.displayName}. Tenés ${deps.session.config.fichitasPerAttendee} fichitas. Miralas con /proyectos y repartilas con /asignar.`;
  } catch (error) {
    if (error instanceof LumaValidationError || error instanceof AllocationError) return error.message;
    throw error;
  }
}

function asignar(deps: HandlerDeps, actor: Actor, args: string): string {
  const attendee = deps.session.attendeeByTelegram(actor.telegramUserId);
  if (!attendee) return "Primero vinculá tu check-in: /vincular <id de Luma>";
  const [projectId, rawAmount] = args.trim().split(/\s+/);
  if (!projectId || !rawAmount) {
    return "Uso: /asignar agua 20";
  }
  const fichitas = Number(rawAmount);
  try {
    deps.session.allocate(attendee.lumaGuestId, projectId, fichitas);
  } catch (error) {
    if (error instanceof AllocationError) return error.message;
    throw error;
  }
  const left = deps.session.remainingFichitas(attendee.lumaGuestId);
  return `Anoté ${fichitas} fichitas en ${projectId}. Te quedan ${left}.`;
}

function fichitas(deps: HandlerDeps, actor: Actor): string {
  const attendee = deps.session.attendeeByTelegram(actor.telegramUserId);
  if (!attendee) return "Todavía no tenés fichitas. Vinculate con /vincular <id de Luma>.";
  const lines = [`${attendee.displayName}: te quedan ${deps.session.remainingFichitas(attendee.lumaGuestId)} fichitas.`];
  for (const project of deps.session.listProjects()) {
    const amount = deps.session.allocationOf(attendee.lumaGuestId, project.id);
    if (amount > 0) lines.push(`· ${project.name}: ${amount}`);
  }
  return lines.join("\n");
}

function proyectos(deps: HandlerDeps): string {
  const list = deps.session.listProjects();
  if (list.length === 0) return "La ronda todavía no tiene proyectos.";
  return list
    .map((project) => `${project.id} — ${project.name}\n${project.summary}`)
    .join("\n\n");
}

async function pagar(deps: HandlerDeps): Promise<string> {
  try {
    const outcome = await executePayout({
      lines: deps.session.plan(),
      approved: deps.session.isApproved(),
      dryRun: deps.dryRun,
      ...(deps.sender ? { sender: deps.sender } : {}),
    });
    const detail = outcome.transfers
      .map((transfer) => `${transfer.recipient}: ${formatWars(transfer.amount)}`)
      .join("\n");
    if (outcome.dryRun) {
      return `Dry-run. No se envió nada a Celo.\nEtiqueta ${outcome.attributionCode}\n${detail}`;
    }
    return `Pagos enviados.\n${outcome.hashes.join("\n")}`;
  } catch (error) {
    if (error instanceof PayoutError || error instanceof AllocationError) return error.message;
    throw error;
  }
}

export async function handleCommand(deps: HandlerDeps, actor: Actor, command: string, args: string): Promise<string> {
  switch (command) {
    case "start":
    case "ayuda":
      return helpText(isAdmin(deps, actor));
    case "vincular":
      return vincular(deps, actor, args);
    case "proyectos":
      return proyectos(deps);
    case "fichitas":
      return fichitas(deps, actor);
    case "asignar":
      return asignar(deps, actor, args);
    case "tablero":
      return renderTextBoard(deps.session);
    case "aprobar":
      if (!isAdmin(deps, actor)) return "Solo la organización puede aprobar el pago.";
      try {
        deps.session.approve();
      } catch (error) {
        if (error instanceof AllocationError) return error.message;
        throw error;
      }
      return "Pozo aprobado. La votación quedó cerrada. /pagar envía wARS si no estás en dry-run.";
    case "pagar":
      if (!isAdmin(deps, actor)) return "Solo la organización puede pagar el pozo.";
      return pagar(deps);
    default:
      return "No conozco ese comando. /ayuda";
  }
}
