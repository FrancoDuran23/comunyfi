import { isAddress, getAddress, type Address, type Hash } from "viem";
import { normalizeEmail, LumaValidationError, type LumaValidator } from "../luma/checkin.js";
import { formatCelo, formatWars } from "../format.js";
import { claimFichitas } from "../voting/claim.js";
import type { Session } from "../voting/session.js";
import { AllocationError, type Project } from "../voting/types.js";
import { renderTextBoard, roundStatusLabel } from "../projector/view.js";
import { fallbackHint, PAYOUT_RESULT_WAIT_MS } from "../payout/constants.js";
import { celoscanTxUrl, executePayout, isPlaceholderRecipient, PayoutError, type PayoutSender } from "../wallet/payout.js";
import type { PoolBalances } from "../wallet/balance.js";

export interface Actor {
  telegramUserId: number;
  displayName: string;
}

export interface ReplyButton {
  text: string;
  data: string;
}

export interface BotReply {
  text: string;
  buttons?: ReplyButton[][];
}

export interface HandlerDeps {
  session: Session;
  luma: LumaValidator;
  adminIds: ReadonlySet<number>;
  dryRun: boolean;
  /** En el Worker el pago no se firma acá: se guarda el plan y lo manda Actions o la laptop. */
  remotePayout?: boolean;
  payoutQueue?: PayoutQueue;
  poolWallet: Address | null;
  sender?: PayoutSender;
  readBalances?: (address: Address) => Promise<PoolBalances>;
}

const LIVE_CONFIRM_MS = 5 * 60 * 1000;

export interface PayoutQueue {
  dispatch(idempotencyKey: string): Promise<{ ok: boolean; status: number }>;
  armFallback(delayMs: number): void;
}

function isAdmin(deps: HandlerDeps, actor: Actor): boolean {
  return deps.adminIds.has(actor.telegramUserId);
}

function reply(text: string, buttons?: ReplyButton[][]): BotReply {
  return buttons && buttons.length > 0 ? { text, buttons } : { text };
}

function projectButtons(session: Session, actor: Actor): ReplyButton[][] {
  const attendee = session.attendeeByTelegram(actor.telegramUserId);
  return session.listProjects().map((project) => {
    const current = attendee ? session.allocationOf(attendee.lumaGuestId, project.id) : 0;
    const label = current > 0 ? `${project.name} · ${current}` : project.name;
    return [{ text: label, data: `proj:${project.id}` }];
  });
}

function amountButtons(projectId: string, available: number, current: number): ReplyButton[][] {
  const steps = [10, 20, 30, 40, 50, 100].filter((amount) => amount <= available);
  if (available > 0 && !steps.includes(available)) steps.push(available);
  steps.sort((a, b) => a - b);
  const amounts = steps.map((amount) => ({ text: String(amount), data: `set:${projectId}:${amount}` }));
  const rows: ReplyButton[][] = [];
  for (let index = 0; index < amounts.length; index += 4) rows.push(amounts.slice(index, index + 4));
  if (current > 0) rows.push([{ text: "Sacar", data: `set:${projectId}:0` }]);
  rows.push([{ text: "Volver", data: "menu:proyectos" }]);
  return rows;
}

function adminButtons(): ReplyButton[][] {
  return [
    [
      { text: "Abrir votación", data: "admin:abrir" },
      { text: "Cerrar votación", data: "admin:cerrar" },
    ],
    [
      { text: "Resultados", data: "admin:resultados" },
      { text: "Previsualizar", data: "admin:preview" },
    ],
    [{ text: "Aprobar pago", data: "admin:aprobar" }],
  ];
}

function helpText(admin: boolean): string {
  const lines = [
    "Mandame el mail con el que te anotaste en Luma.",
    "/proyectos — ver la ronda y poner fichitas",
    "/fichitas — tu resumen",
    "/tablero — cómo va la votación",
    "/pozo — saldo de wARS y CELO del agente",
  ];
  if (admin) {
    lines.push(
      "",
      "Organización:",
      "/admin — menú",
      "/ronda — estado",
      "/ronda nueva <nombre> — crear la ronda si no hay",
      "/proyecto id | nombre | resumen | 0xwallet",
      "/editar id | nombre | resumen | 0xwallet",
      "/abrir y /cerrar — la votación",
      "/previsualizar — el reparto, sin mandar nada",
      "/aprobar — pagar (en dry-run no sale a la red)",
    );
  }
  return lines.join("\n");
}

function summaryText(session: Session, actor: Actor): string {
  const attendee = session.attendeeByTelegram(actor.telegramUserId);
  if (!attendee) {
    return "Todavía no tenés fichitas. Mandame el mail con el que te anotaste en Luma.";
  }
  const lines = [
    `${attendee.displayName} (${attendee.email})`,
    `Te quedan ${session.remainingFichitas(attendee.lumaGuestId)} fichitas de ${session.config.fichitasPerAttendee}.`,
    `Tope por proyecto: ${session.config.maxFichitasPerProject}.`,
  ];
  for (const project of session.listProjects()) {
    const amount = session.allocationOf(attendee.lumaGuestId, project.id);
    if (amount > 0) lines.push(`· ${project.name}: ${amount}`);
  }
  const status = session.votingStatus();
  if (status !== "open") {
    lines.push("", roundStatusLabel(status) + ".");
  }
  return lines.join("\n");
}

export function parseProjectArgs(args: string): { id: string; name: string; summary: string; recipient: string } | { error: string } {
  const parts = args.split("|").map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => part.length === 0)) {
    return { error: "Usá: /proyecto id | nombre | resumen | 0xwallet" };
  }
  const [id, name, summary, recipient] = parts;
  if (!id || !name || !summary || !recipient) {
    return { error: "Usá: /proyecto id | nombre | resumen | 0xwallet" };
  }
  return { id, name, summary, recipient };
}

async function vincular(deps: HandlerDeps, actor: Actor, rawEmail: string): Promise<BotReply> {
  const existing = deps.session.attendeeByTelegram(actor.telegramUserId);
  if (existing) {
    return reply(`Ya estás adentro, ${existing.displayName}.\n${summaryText(deps.session, actor)}`, projectButtons(deps.session, actor));
  }
  const email = normalizeEmail(rawEmail);
  if (!email) return reply("Pasame el mail con el que te anotaste en Luma. Ejemplo: ana@jujuy.dev");
  try {
    const attendee = await claimFichitas({
      session: deps.session,
      luma: deps.luma,
      email,
      telegramUserId: actor.telegramUserId,
      displayName: actor.displayName,
    });
    const open = deps.session.votingStatus() === "open";
    const text = open
      ? `Listo, ${attendee.displayName}. Tenés ${deps.session.config.fichitasPerAttendee} fichitas. Tocá un proyecto y elegí cuántas dejar.`
      : `Listo, ${attendee.displayName}. Tenés ${deps.session.config.fichitasPerAttendee} fichitas. La votación todavía no está abierta: cuando la abran, tocá un proyecto.`;
    return reply(text, open ? projectButtons(deps.session, actor) : undefined);
  } catch (error) {
    if (error instanceof LumaValidationError || error instanceof AllocationError) return reply(error.message);
    throw error;
  }
}

function asignar(deps: HandlerDeps, actor: Actor, args: string): BotReply {
  const attendee = deps.session.attendeeByTelegram(actor.telegramUserId);
  if (!attendee) return reply("Primero vinculá el mail con el que te anotaste en Luma.");
  const [projectId, rawAmount] = args.trim().split(/\s+/);
  if (!projectId || rawAmount === undefined) return reply("Uso: /asignar agua 20\nEse número reemplaza lo que ya tenías en ese proyecto.");
  const fichitas = Number(rawAmount);
  return applyFichitas(deps, actor, projectId, fichitas);
}

function applyFichitas(deps: HandlerDeps, actor: Actor, projectId: string, fichitas: number): BotReply {
  const attendee = deps.session.attendeeByTelegram(actor.telegramUserId);
  if (!attendee) return reply("Primero vinculá el mail con el que te anotaste en Luma.");
  const before = deps.session.allocationOf(attendee.lumaGuestId, projectId);
  try {
    deps.session.setFichitas(attendee.lumaGuestId, projectId, fichitas);
  } catch (error) {
    if (error instanceof AllocationError) return reply(error.message, projectButtons(deps.session, actor));
    throw error;
  }
  const left = deps.session.remainingFichitas(attendee.lumaGuestId);
  const project = deps.session.listProjects().find((item) => item.id === projectId);
  const name = project?.name ?? projectId;
  const text =
    fichitas === 0
      ? `Saqué tus fichitas de ${name}. Te quedan ${left}.`
      : before === fichitas
        ? `En ${name} ya tenías ${fichitas}. Te quedan ${left}.`
        : `Listo. En ${name} dejaste ${fichitas} fichitas. Te quedan ${left}.`;
  return reply(text, projectButtons(deps.session, actor));
}

function proyectos(deps: HandlerDeps, actor: Actor): BotReply {
  const list = deps.session.listProjects();
  if (list.length === 0) return reply("La ronda todavía no tiene proyectos.");
  const body = list.map((project) => `${project.name}\n${project.summary}`).join("\n\n");
  const hint =
    deps.session.votingStatus() === "open"
      ? "Tocá un proyecto para poner o cambiar fichitas."
      : "Cuando la votación esté abierta, tocá un proyecto para repartir.";
  return reply(`${body}\n\n${hint}`, projectButtons(deps.session, actor));
}

function projectDetail(deps: HandlerDeps, actor: Actor, projectId: string): BotReply {
  const attendee = deps.session.attendeeByTelegram(actor.telegramUserId);
  if (!attendee) return reply("Primero vinculá el mail con el que te anotaste en Luma.");
  const project = deps.session.listProjects().find((item) => item.id === projectId);
  if (!project) return reply("Ese proyecto no está en la ronda.");
  if (deps.session.votingStatus() !== "open") {
    return reply(`${project.name}\n${project.summary}\n\n${roundStatusLabel(deps.session.votingStatus())}. Ahora no podés mover fichitas.`);
  }
  const current = deps.session.allocationOf(attendee.lumaGuestId, project.id);
  const available = Math.min(deps.session.config.maxFichitasPerProject, deps.session.remainingFichitas(attendee.lumaGuestId) + current);
  if (available === 0 && current === 0) {
    return reply(`No te quedan fichitas para poner en ${project.name}.`, projectButtons(deps.session, actor));
  }
  return reply(
    `${project.name}\n${project.summary}\n\nAhora tenés ${current}. Podés dejar hasta ${available} en este proyecto. Si ya tenías, el número nuevo las reemplaza.`,
    amountButtons(project.id, available, current),
  );
}

function requireAdmin(deps: HandlerDeps, actor: Actor): BotReply | null {
  if (!isAdmin(deps, actor)) return reply("Eso es de la organización.");
  return null;
}

function guardarProyecto(deps: HandlerDeps, args: string, mode: "add" | "edit"): BotReply {
  const parsed = parseProjectArgs(args);
  if ("error" in parsed) return reply(parsed.error);
  if (!isAddress(parsed.recipient)) return reply("Esa wallet no es una dirección de Celo.");
  const project: Project = {
    id: parsed.id,
    name: parsed.name,
    summary: parsed.summary,
    recipient: getAddress(parsed.recipient),
  };
  try {
    if (mode === "add") deps.session.addProject(project);
    else deps.session.updateProject(project);
  } catch (error) {
    if (error instanceof AllocationError) return reply(error.message);
    throw error;
  }
  const warning = isPlaceholderRecipient(project.recipient)
    ? "\nOjo: esa dirección es de relleno. Un pago real la va a rechazar."
    : "";
  const verb = mode === "add" ? "Cargué" : "Actualicé";
  return reply(`${verb} ${project.name} (${project.id}) → ${project.recipient}.${warning}`);
}

function ronda(deps: HandlerDeps, args: string): BotReply {
  const nueva = args.trim();
  if (nueva.toLowerCase().startsWith("nueva")) {
    const name = nueva.slice("nueva".length).trim() || "jujuy.dev";
    if (deps.session.hasRound()) {
      return reply(`Ya hay una ronda cargada: ${deps.session.roundName()} (${roundStatusLabel(deps.session.votingStatus())}). Sigue guardada en la base.`);
    }
    deps.session.ensureRound(name);
    return reply(`Creé la ronda "${name}". Está en borrador. Cargá proyectos con /proyecto y después /abrir.`);
  }
  if (!deps.session.hasRound()) return reply("No hay ronda. Creala con /ronda nueva jujuy.dev");
  const lines = deps.session.plan();
  return reply(
    [
      `${deps.session.roundName()} · ${roundStatusLabel(deps.session.votingStatus())}`,
      `Pozo ${formatWars(deps.session.config.poolAmount)}`,
      `${deps.session.listAttendees().length} asistentes · ${deps.session.listProjects().length} proyectos`,
      lines.length === 0 ? "Todavía no hay fichitas repartidas." : `${lines.length} proyectos con fichitas.`,
    ].join("\n"),
    adminButtons(),
  );
}

function mutateVoting(deps: HandlerDeps, action: "open" | "close"): BotReply {
  try {
    if (action === "open") deps.session.openVoting();
    else deps.session.closeVoting();
  } catch (error) {
    if (error instanceof AllocationError) return reply(error.message);
    throw error;
  }
  return reply(action === "open" ? "Listo, la votación está abierta." : "Listo, la votación está cerrada. Ya podés previsualizar y aprobar.");
}

async function previsualizar(deps: HandlerDeps): Promise<BotReply> {
  if (deps.session.votingStatus() === "open") {
    return reply("Cerrá la votación antes de mirar el pago final. /cerrar");
  }
  if (deps.session.votingStatus() === "draft" || deps.session.votingStatus() === null) {
    return reply("La ronda sigue en borrador.");
  }
  try {
    const outcome = await executePayout({
      lines: deps.session.plan(),
      approved: true,
      dryRun: true,
    });
    const detail = outcome.transfers.map((transfer) => `${transfer.recipient}\n  ${formatWars(transfer.amount)}`).join("\n");
    return reply(`Previsualización. No se envió nada.\nEtiqueta ${outcome.attributionCode}\n\n${detail}`);
  } catch (error) {
    if (error instanceof PayoutError || error instanceof AllocationError) return reply(error.message);
    throw error;
  }
}

function unpaidLines(deps: HandlerDeps) {
  const alreadyPaid = deps.session.livePaidRecipients();
  return deps.session.plan().filter((line) => line.amount > 0n && !alreadyPaid.has(line.recipient.toLowerCase()));
}

async function encolarPago(deps: HandlerDeps, adminTelegramId: number): Promise<BotReply> {
  const queue = deps.payoutQueue;
  if (!queue) return reply("No hay un runner configurado.");
  const lines = unpaidLines(deps);
  if (lines.length === 0) {
    try {
      deps.session.completePayout();
    } catch (error) {
      if (!(error instanceof AllocationError)) throw error;
    }
    return reply("Esos pagos ya salieron. No volví a mandar nada.");
  }
  for (const line of lines) {
    if (isPlaceholderRecipient(line.recipient)) {
      return reply(`Reemplazá el destinatario de relleno ${line.recipient} antes de un pago real`);
    }
  }
  try {
    deps.session.beginPayout();
  } catch (error) {
    if (error instanceof AllocationError) return reply(error.message);
    throw error;
  }
  const plan = deps.session.ensurePayoutPlan({
    roundId: 1,
    adminTelegramId,
    createdAt: Date.now(),
    lines,
  });
  return despachar(deps, plan.idempotencyKey);
}

async function redispachar(deps: HandlerDeps): Promise<BotReply> {
  const plan = deps.session.currentPayoutPlan();
  if (!deps.payoutQueue || !plan) return reply("No hay un pago en curso.");
  if (plan.lines.every((line) => line.txHash)) {
    deps.session.completePayout();
    return reply("Esos pagos ya salieron. No volví a mandar nada.");
  }
  return despachar(deps, plan.idempotencyKey);
}

async function despachar(deps: HandlerDeps, idempotencyKey: string): Promise<BotReply> {
  const queue = deps.payoutQueue;
  if (!queue) return reply("No hay un runner configurado.");
  const dispatched = await queue.dispatch(idempotencyKey);
  if (!dispatched.ok) {
    deps.session.markPayoutFallbackNotified(idempotencyKey);
    return reply(
      `Pagando… No pude avisar a GitHub Actions (HTTP ${dispatched.status}). El workflow solo corre cuando está en main. ${fallbackHint()}`,
    );
  }
  queue.armFallback(PAYOUT_RESULT_WAIT_MS);
  return reply("Pagando…");
}

async function aprobar(deps: HandlerDeps, actor: Actor, args: string): Promise<BotReply> {
  const status = deps.session.votingStatus();
  if (status === "open") return reply("Cerrá la votación antes de aprobar el pago. /cerrar");
  if (status === "paid") return reply("El pozo ya se pagó.");
  if (status === "paying" && deps.payoutQueue) return redispachar(deps);
  if (status !== "closed") return reply("Abrí y cerrá la votación antes de aprobar el pago.");

  const confirm = args.trim().toUpperCase() === "CONFIRMAR";
  if (!deps.dryRun && !confirm) {
    deps.session.setPending(actor.telegramUserId, "live_payout", "1", LIVE_CONFIRM_MS);
    const preview = await previsualizar(deps);
    return reply(
      `${preview.text}\n\nEsto va a mandar wARS de verdad desde la wallet del agente. Si estás seguro, respondé /aprobar CONFIRMAR dentro de 5 minutos.`,
    );
  }
  if (!deps.dryRun) {
    const pending = deps.session.takePending(actor.telegramUserId, "live_payout");
    if (!pending) return reply("No hay un pago esperando confirmación, o se venció. Mandá /aprobar de nuevo.");
  }

  if (!deps.dryRun && deps.payoutQueue) return encolarPago(deps, actor.telegramUserId);

  const alreadyPaid = deps.session.livePaidRecipients();
  const lines = deps.session.plan().filter((line) => !alreadyPaid.has(line.recipient.toLowerCase()));
  if (lines.length === 0) {
    try {
      deps.session.approve();
    } catch (error) {
      if (!(error instanceof AllocationError)) throw error;
    }
    return reply("Esos pagos ya salieron. No volví a mandar nada.");
  }

  const hashes: Hash[] = [];
  try {
    const outcome = await executePayout({
      lines,
      approved: true,
      dryRun: deps.dryRun,
      ...(deps.sender ? { sender: deps.sender } : {}),
      onSent: (hash, transfer) => {
        const line = lines.find((item) => item.recipient.toLowerCase() === transfer.recipient.toLowerCase());
        deps.session.recordPayout({
          projectId: line?.projectId ?? "desconocido",
          recipient: transfer.recipient,
          amount: transfer.amount,
          txHash: hash,
          dryRun: false,
        });
        hashes.push(hash);
      },
    });
    if (outcome.dryRun) {
      const detail = outcome.transfers.map((transfer) => `${transfer.recipient}\n  ${formatWars(transfer.amount)}`).join("\n");
      return reply(
        `Ensayo de /aprobar. No salió nada a Celo.\nEtiqueta ${outcome.attributionCode}\n\n${detail}\n\n${
          deps.remotePayout
            ? "Para mandarlo de verdad: PAYOUT_DRY_RUN=false en el Worker y en el repo, y /aprobar CONFIRMAR."
            : "Para mandarlo de verdad: PAYOUT_DRY_RUN=false, AGENT_PRIVATE_KEY, y /aprobar CONFIRMAR."
        }`,
      );
    }
    deps.session.approve();
    const links = outcome.hashes.map((hash) => celoscanTxUrl(hash)).join("\n");
    return reply(`Listo, el pozo salió.\nEtiqueta ${outcome.attributionCode}\n${links}`);
  } catch (error) {
    if (hashes.length > 0) {
      const links = hashes.map((hash) => celoscanTxUrl(hash)).join("\n");
      const message = error instanceof Error ? error.message : "Falló el envío";
      return reply(`Se mandó una parte y después falló: ${message}\n${links}\nNo vuelvas a aprobar esos destinatarios: quedaron anotados.`);
    }
    if (error instanceof PayoutError || error instanceof AllocationError) return reply(error.message);
    throw error;
  }
}

async function pozo(deps: HandlerDeps): Promise<BotReply> {
  if (!deps.poolWallet) {
    return reply("No hay wallet del agente configurada. Completá AGENT_PRIVATE_KEY o AGENT_WALLET.");
  }
  if (!deps.readBalances) {
    return reply(`Wallet del agente: ${deps.poolWallet}\nNo puedo leer el saldo sin un cliente de Celo.`);
  }
  try {
    const balances = await deps.readBalances(deps.poolWallet);
    return reply(
      `Pozo del agente\n${deps.poolWallet}\nwARS: ${formatWars(balances.wars)}\nCELO para gas: ${formatCelo(balances.celo)}`,
    );
  } catch {
    return reply("No pude leer la red. Fijate CELO_RPC_URL.");
  }
}

export async function handleCommand(deps: HandlerDeps, actor: Actor, command: string, args: string): Promise<BotReply> {
  switch (command) {
    case "start": {
      const linked = deps.session.attendeeByTelegram(actor.telegramUserId);
      const intro = linked
        ? summaryText(deps.session, actor)
        : "Hola, soy Comunyfi.\n\nEn jujuy.dev hay un pozo en wARS. Si hiciste check-in en Luma, te doy fichitas para repartir entre los proyectos.\n\nMandame el mail con el que te anotaste en Luma.";
      const admin = isAdmin(deps, actor) ? "\n\nTambién sos de la organización. Mirá /admin." : "";
      return reply(`${intro}${admin}\n\nTu id de Telegram es ${actor.telegramUserId}.`, linked ? projectButtons(deps.session, actor) : undefined);
    }
    case "ayuda":
      return reply(helpText(isAdmin(deps, actor)));
    case "vincular":
      return vincular(deps, actor, args);
    case "proyectos":
      return proyectos(deps, actor);
    case "fichitas":
    case "resumen":
      return reply(summaryText(deps.session, actor), projectButtons(deps.session, actor));
    case "asignar":
      return asignar(deps, actor, args);
    case "tablero":
    case "resultados":
      return reply(renderTextBoard(deps.session));
    case "pozo":
      return pozo(deps);
    case "admin": {
      const denied = requireAdmin(deps, actor);
      if (denied) return denied;
      return reply("Menú de la organización.", adminButtons());
    }
    case "ronda": {
      const denied = requireAdmin(deps, actor);
      if (denied) return denied;
      return ronda(deps, args);
    }
    case "proyecto": {
      const denied = requireAdmin(deps, actor);
      if (denied) return denied;
      return guardarProyecto(deps, args, "add");
    }
    case "editar": {
      const denied = requireAdmin(deps, actor);
      if (denied) return denied;
      return guardarProyecto(deps, args, "edit");
    }
    case "abrir": {
      const denied = requireAdmin(deps, actor);
      if (denied) return denied;
      return mutateVoting(deps, "open");
    }
    case "cerrar": {
      const denied = requireAdmin(deps, actor);
      if (denied) return denied;
      return mutateVoting(deps, "close");
    }
    case "previsualizar": {
      const denied = requireAdmin(deps, actor);
      if (denied) return denied;
      return previsualizar(deps);
    }
    case "aprobar": {
      const denied = requireAdmin(deps, actor);
      if (denied) return denied;
      return aprobar(deps, actor, args);
    }
    default:
      return reply("No conozco ese comando. /ayuda");
  }
}

export async function handleCallback(deps: HandlerDeps, actor: Actor, data: string): Promise<BotReply> {
  if (data === "menu:proyectos") return proyectos(deps, actor);
  if (data.startsWith("proj:")) return projectDetail(deps, actor, data.slice("proj:".length));
  if (data.startsWith("set:")) {
    const [, projectId, rawAmount] = data.split(":");
    if (!projectId || rawAmount === undefined) return reply("No entendí esa ficha.");
    return applyFichitas(deps, actor, projectId, Number(rawAmount));
  }
  if (data.startsWith("admin:")) {
    const denied = requireAdmin(deps, actor);
    if (denied) return denied;
    switch (data.slice("admin:".length)) {
      case "abrir":
        return mutateVoting(deps, "open");
      case "cerrar":
        return mutateVoting(deps, "close");
      case "resultados":
        return reply(renderTextBoard(deps.session));
      case "preview":
        return previsualizar(deps);
      case "aprobar":
        return aprobar(deps, actor, "");
      default:
        return reply("Esa acción no existe.");
    }
  }
  return reply("No entendí ese botón.");
}

export async function handlePlainText(deps: HandlerDeps, actor: Actor, text: string): Promise<BotReply> {
  const email = normalizeEmail(text);
  if (email) return vincular(deps, actor, email);
  return reply("Si venís a votar, mandame el mail de Luma. Si no, /ayuda.");
}
