import { getAddress, isAddress } from "viem";
import type { SqlDb } from "../store/sql.js";
import { planPayouts, standings } from "./allocation.js";
import {
  AllocationError,
  AllocationErrorCode,
  type Attendee,
  type PayoutLine,
  type Project,
  type RoundStatus,
  type SessionConfig,
  type Standing,
} from "./types.js";

const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const STATUSES = new Set<RoundStatus>(["draft", "open", "closed", "paid"]);

export interface PendingAction {
  kind: string;
  payload: string;
}

export interface RecordedPayout {
  projectId: string;
  recipient: string;
  amount: bigint;
  txHash: string | null;
  dryRun: boolean;
}

export interface Session {
  readonly config: SessionConfig;
  ensureRound(name: string, options?: { status?: RoundStatus }): boolean;
  hasRound(): boolean;
  roundName(): string | null;
  votingStatus(): RoundStatus | null;
  addProject(project: Project): void;
  updateProject(project: Project): void;
  registerAttendee(attendee: Attendee): void;
  /** Deja la cantidad exacta. Cero saca las fichitas de ese proyecto. */
  setFichitas(lumaGuestId: string, projectId: string, fichitas: number): void;
  openVoting(): void;
  closeVoting(): void;
  approve(): void;
  isApproved(): boolean;
  attendeeByTelegram(telegramUserId: number): Attendee | undefined;
  attendeeByEmail(email: string): Attendee | undefined;
  attendeeByLuma(lumaGuestId: string): Attendee | undefined;
  remainingFichitas(lumaGuestId: string): number;
  allocationOf(lumaGuestId: string, projectId: string): number;
  listProjects(): Project[];
  listAttendees(): Attendee[];
  fichitasByProject(): Map<string, number>;
  plan(): PayoutLine[];
  standings(): Standing[];
  setPending(telegramUserId: number, kind: string, payload: string, ttlMs: number): void;
  takePending(telegramUserId: number, kind: string): PendingAction | null;
  recordPayout(entry: RecordedPayout): void;
  livePaidRecipients(): Set<string>;
  close(): void;
}

interface RoundRow {
  name: string;
  status: string;
  pool_amount: string;
  fichitas_per_attendee: number;
  max_fichitas_per_project: number;
}

function assertConfig(config: SessionConfig): void {
  if (config.poolAmount < 0n) {
    throw new AllocationError(AllocationErrorCode.INVALID_CONFIG, "El pozo no puede ser negativo");
  }
  if (!Number.isInteger(config.fichitasPerAttendee) || config.fichitasPerAttendee <= 0) {
    throw new AllocationError(
      AllocationErrorCode.INVALID_CONFIG,
      "Las fichitas por asistente tienen que ser un entero positivo",
    );
  }
  if (!Number.isInteger(config.maxFichitasPerProject) || config.maxFichitasPerProject <= 0) {
    throw new AllocationError(
      AllocationErrorCode.INVALID_CONFIG,
      "El tope por proyecto tiene que ser un entero positivo",
    );
  }
  if (config.maxFichitasPerProject > config.fichitasPerAttendee) {
    throw new AllocationError(
      AllocationErrorCode.INVALID_CONFIG,
      "El tope por proyecto no puede superar el presupuesto de fichitas",
    );
  }
}

function normalizeProject(project: Project): Project {
  const id = project.id.trim().toLowerCase();
  const name = project.name.trim();
  const summary = project.summary.trim();
  if (!PROJECT_ID.test(id) || name.length === 0 || summary.length === 0) {
    throw new AllocationError(
      AllocationErrorCode.INVALID_PROJECT,
      "El proyecto necesita id (a-z, 0-9, guiones), nombre y resumen",
    );
  }
  if (!isAddress(project.recipient)) {
    throw new AllocationError(AllocationErrorCode.INVALID_PROJECT, "La wallet del proyecto no es una dirección");
  }
  const recipient = getAddress(project.recipient);
  if (recipient === "0x0000000000000000000000000000000000000000") {
    throw new AllocationError(AllocationErrorCode.INVALID_PROJECT, "La wallet no puede ser la dirección cero");
  }
  return { id, name, summary, recipient };
}

function asStatus(value: string): RoundStatus {
  if (!STATUSES.has(value as RoundStatus)) {
    throw new AllocationError(AllocationErrorCode.INVALID_CONFIG, "La ronda tiene un estado inválido");
  }
  return value as RoundStatus;
}

export function sessionFromDb(db: SqlDb, defaults: SessionConfig): Session {
  assertConfig(defaults);
  return bindSession(db, defaults);
}

function bindSession(db: SqlDb, defaults: SessionConfig): Session {
  const readRound = db.prepare(
    "SELECT name, status, pool_amount, fichitas_per_attendee, max_fichitas_per_project FROM round WHERE id = 1",
  );
  const insertRound = db.prepare(
    `INSERT INTO round (id, name, status, pool_amount, fichitas_per_attendee, max_fichitas_per_project)
     VALUES (1, ?, ?, ?, ?, ?)`,
  );
  const updateStatus = db.prepare("UPDATE round SET status = ? WHERE id = 1");

  function roundRow(): RoundRow | undefined {
    return readRound.get() as RoundRow | undefined;
  }

  function requireRound(): RoundRow {
    const row = roundRow();
    if (!row) {
      throw new AllocationError(AllocationErrorCode.NO_ROUND, "Todavía no hay una ronda. La organización tiene que crearla.");
    }
    return row;
  }

  function statusOf(row: RoundRow = requireRound()): RoundStatus {
    return asStatus(row.status);
  }

  function configOf(row: RoundRow = requireRound()): SessionConfig {
    return {
      poolAmount: BigInt(row.pool_amount),
      fichitasPerAttendee: row.fichitas_per_attendee,
      maxFichitasPerProject: row.max_fichitas_per_project,
    };
  }

  function freezeIfPaid(status: RoundStatus): void {
    if (status === "paid") {
      throw new AllocationError(AllocationErrorCode.SESSION_FROZEN, "El pozo ya se pagó. No se puede cambiar nada.");
    }
  }

  function requireVotingOpen(): SessionConfig {
    const row = requireRound();
    const status = statusOf(row);
    freezeIfPaid(status);
    if (status !== "open") {
      throw new AllocationError(
        AllocationErrorCode.VOTING_CLOSED,
        status === "draft"
          ? "La votación todavía no está abierta."
          : "La votación ya cerró. No podés cambiar las fichitas.",
      );
    }
    return configOf(row);
  }

  function spentBy(lumaGuestId: string): number {
    const row = db.prepare("SELECT COALESCE(SUM(fichitas), 0) AS total FROM allocations WHERE luma_guest_id = ?").get(lumaGuestId) as
      | { total: number }
      | undefined;
    return row?.total ?? 0;
  }

  function mapAttendee(row: {
    luma_guest_id: string;
    email: string;
    telegram_user_id: number;
    display_name: string;
  }): Attendee {
    return {
      lumaGuestId: row.luma_guest_id,
      email: row.email,
      telegramUserId: row.telegram_user_id,
      displayName: row.display_name,
    };
  }

  const session: Session = {
    get config() {
      const row = roundRow();
      return row ? configOf(row) : defaults;
    },

    ensureRound(name, options) {
      const existing = roundRow();
      if (existing) return false;
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        throw new AllocationError(AllocationErrorCode.INVALID_CONFIG, "La ronda necesita un nombre");
      }
      const status = options?.status ?? "draft";
      insertRound.run(trimmed, status, defaults.poolAmount.toString(), defaults.fichitasPerAttendee, defaults.maxFichitasPerProject);
      return true;
    },

    hasRound() {
      return roundRow() !== undefined;
    },

    roundName() {
      return roundRow()?.name ?? null;
    },

    votingStatus() {
      const row = roundRow();
      return row ? statusOf(row) : null;
    },

    addProject(project) {
      const status = statusOf();
      freezeIfPaid(status);
      const normalized = normalizeProject(project);
      const exists = db.prepare("SELECT id FROM projects WHERE id = ?").get(normalized.id);
      if (exists) {
        throw new AllocationError(AllocationErrorCode.DUPLICATE_PROJECT, `El proyecto ${normalized.id} ya existe. Usá /editar.`);
      }
      db.prepare("INSERT INTO projects (id, name, summary, recipient) VALUES (?, ?, ?, ?)").run(
        normalized.id,
        normalized.name,
        normalized.summary,
        normalized.recipient,
      );
    },

    updateProject(project) {
      const status = statusOf();
      freezeIfPaid(status);
      const normalized = normalizeProject(project);
      const result = db.prepare("UPDATE projects SET name = ?, summary = ?, recipient = ? WHERE id = ?").run(
        normalized.name,
        normalized.summary,
        normalized.recipient,
        normalized.id,
      );
      if (Number(result.changes) === 0) {
        throw new AllocationError(AllocationErrorCode.UNKNOWN_PROJECT, "Ese proyecto no está en la ronda");
      }
    },

    registerAttendee(attendee) {
      const status = statusOf();
      freezeIfPaid(status);
      if (status === "closed") {
        throw new AllocationError(AllocationErrorCode.VOTING_CLOSED, "La votación ya cerró. No puedo dar fichitas nuevas.");
      }
      const lumaGuestId = attendee.lumaGuestId.trim();
      const email = attendee.email.trim().toLowerCase();
      const displayName = attendee.displayName.trim();
      if (lumaGuestId.length === 0 || email.length === 0 || displayName.length === 0) {
        throw new AllocationError(
          AllocationErrorCode.INVALID_ATTENDEE,
          "El asistente necesita mail de Luma, invitado y nombre",
        );
      }
      if (!Number.isInteger(attendee.telegramUserId) || attendee.telegramUserId <= 0) {
        throw new AllocationError(AllocationErrorCode.INVALID_ATTENDEE, "El usuario de Telegram no es válido");
      }
      const byGuest = db.prepare("SELECT telegram_user_id FROM attendees WHERE luma_guest_id = ?").get(lumaGuestId) as
        | { telegram_user_id: number }
        | undefined;
      const byEmail = db.prepare("SELECT luma_guest_id FROM attendees WHERE email = ?").get(email) as
        | { luma_guest_id: string }
        | undefined;
      if (byGuest || byEmail) {
        throw new AllocationError(AllocationErrorCode.DUPLICATE_ATTENDEE, "Ese mail de Luma ya recibió fichitas.");
      }
      const byTelegram = db.prepare("SELECT luma_guest_id FROM attendees WHERE telegram_user_id = ?").get(attendee.telegramUserId);
      if (byTelegram) {
        throw new AllocationError(AllocationErrorCode.DUPLICATE_TELEGRAM, "Con este Telegram ya reclamaste fichitas.");
      }
      db.prepare(
        "INSERT INTO attendees (luma_guest_id, email, telegram_user_id, display_name) VALUES (?, ?, ?, ?)",
      ).run(lumaGuestId, email, attendee.telegramUserId, displayName);
    },

    setFichitas(lumaGuestId, projectId, fichitas) {
      const config = requireVotingOpen();
      const guestId = lumaGuestId.trim();
      const attendee = db.prepare("SELECT luma_guest_id FROM attendees WHERE luma_guest_id = ?").get(guestId);
      if (!attendee) {
        throw new AllocationError(AllocationErrorCode.UNKNOWN_ATTENDEE, "Primero vinculá el mail con el que te anotaste en Luma.");
      }
      const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId.trim()) as { id: string } | undefined;
      if (!project) {
        throw new AllocationError(AllocationErrorCode.UNKNOWN_PROJECT, "Ese proyecto no está en la ronda.");
      }
      if (!Number.isInteger(fichitas) || fichitas < 0) {
        throw new AllocationError(AllocationErrorCode.INVALID_AMOUNT, "Las fichitas tienen que ser un entero, cero o más.");
      }
      if (fichitas > config.maxFichitasPerProject) {
        throw new AllocationError(
          AllocationErrorCode.PROJECT_CAP_EXCEEDED,
          `El tope es de ${config.maxFichitasPerProject} fichitas por proyecto.`,
        );
      }
      const currentRow = db
        .prepare("SELECT fichitas FROM allocations WHERE luma_guest_id = ? AND project_id = ?")
        .get(guestId, project.id) as { fichitas: number } | undefined;
      const current = currentRow?.fichitas ?? 0;
      const nextSpent = spentBy(guestId) - current + fichitas;
      if (nextSpent > config.fichitasPerAttendee) {
        throw new AllocationError(
          AllocationErrorCode.BUDGET_EXCEEDED,
          `No te alcanzan. Te quedan ${config.fichitasPerAttendee - (spentBy(guestId) - current)} fichitas.`,
        );
      }
      if (fichitas === 0) {
        db.prepare("DELETE FROM allocations WHERE luma_guest_id = ? AND project_id = ?").run(guestId, project.id);
        return;
      }
      db.prepare(
        `INSERT INTO allocations (luma_guest_id, project_id, fichitas) VALUES (?, ?, ?)
         ON CONFLICT (luma_guest_id, project_id) DO UPDATE SET fichitas = excluded.fichitas`,
      ).run(guestId, project.id, fichitas);
    },

    openVoting() {
      const row = requireRound();
      const status = statusOf(row);
      freezeIfPaid(status);
      if (status === "open") {
        throw new AllocationError(AllocationErrorCode.ALREADY_OPEN, "La votación ya está abierta.");
      }
      const count = db.prepare("SELECT COUNT(*) AS total FROM projects").get() as { total: number };
      if (count.total === 0) {
        throw new AllocationError(AllocationErrorCode.NO_PROJECTS, "Cargá al menos un proyecto antes de abrir la votación.");
      }
      updateStatus.run("open");
    },

    closeVoting() {
      const status = statusOf();
      freezeIfPaid(status);
      if (status === "closed") {
        throw new AllocationError(AllocationErrorCode.ALREADY_CLOSED, "La votación ya está cerrada.");
      }
      if (status !== "open") {
        throw new AllocationError(AllocationErrorCode.VOTING_CLOSED, "La votación todavía no está abierta.");
      }
      updateStatus.run("closed");
    },

    approve() {
      const status = statusOf();
      if (status === "paid") {
        throw new AllocationError(AllocationErrorCode.ALREADY_APPROVED, "El pozo ya estaba aprobado.");
      }
      if (status === "open") {
        throw new AllocationError(AllocationErrorCode.VOTING_OPEN, "Cerrá la votación antes de aprobar el pago.");
      }
      if (status !== "closed") {
        throw new AllocationError(AllocationErrorCode.VOTING_CLOSED, "Abrí y cerrá la votación antes de aprobar el pago.");
      }
      updateStatus.run("paid");
    },

    isApproved() {
      return this.votingStatus() === "paid";
    },

    attendeeByTelegram(telegramUserId) {
      const row = db
        .prepare("SELECT luma_guest_id, email, telegram_user_id, display_name FROM attendees WHERE telegram_user_id = ?")
        .get(telegramUserId) as
        | { luma_guest_id: string; email: string; telegram_user_id: number; display_name: string }
        | undefined;
      return row ? mapAttendee(row) : undefined;
    },

    attendeeByEmail(email) {
      const row = db
        .prepare("SELECT luma_guest_id, email, telegram_user_id, display_name FROM attendees WHERE email = ?")
        .get(email.trim().toLowerCase()) as
        | { luma_guest_id: string; email: string; telegram_user_id: number; display_name: string }
        | undefined;
      return row ? mapAttendee(row) : undefined;
    },

    attendeeByLuma(lumaGuestId) {
      const row = db
        .prepare("SELECT luma_guest_id, email, telegram_user_id, display_name FROM attendees WHERE luma_guest_id = ?")
        .get(lumaGuestId.trim()) as
        | { luma_guest_id: string; email: string; telegram_user_id: number; display_name: string }
        | undefined;
      return row ? mapAttendee(row) : undefined;
    },

    remainingFichitas(lumaGuestId) {
      const guestId = lumaGuestId.trim();
      const attendee = db.prepare("SELECT luma_guest_id FROM attendees WHERE luma_guest_id = ?").get(guestId);
      if (!attendee) {
        throw new AllocationError(AllocationErrorCode.UNKNOWN_ATTENDEE, "Asistente desconocido");
      }
      return configOf().fichitasPerAttendee - spentBy(guestId);
    },

    allocationOf(lumaGuestId, projectId) {
      const row = db
        .prepare("SELECT fichitas FROM allocations WHERE luma_guest_id = ? AND project_id = ?")
        .get(lumaGuestId.trim(), projectId.trim()) as { fichitas: number } | undefined;
      return row?.fichitas ?? 0;
    },

    listProjects() {
      const rows = db.prepare("SELECT id, name, summary, recipient FROM projects ORDER BY id").all() as Array<{
        id: string;
        name: string;
        summary: string;
        recipient: string;
      }>;
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        summary: row.summary,
        recipient: getAddress(row.recipient),
      }));
    },

    listAttendees() {
      const rows = db
        .prepare("SELECT luma_guest_id, email, telegram_user_id, display_name FROM attendees ORDER BY display_name")
        .all() as Array<{ luma_guest_id: string; email: string; telegram_user_id: number; display_name: string }>;
      return rows.map(mapAttendee);
    },

    fichitasByProject() {
      const totals = new Map<string, number>();
      for (const project of this.listProjects()) totals.set(project.id, 0);
      const rows = db.prepare("SELECT project_id, SUM(fichitas) AS total FROM allocations GROUP BY project_id").all() as Array<{
        project_id: string;
        total: number;
      }>;
      for (const row of rows) totals.set(row.project_id, row.total);
      return totals;
    },

    plan() {
      const config = this.hasRound() ? configOf() : defaults;
      return planPayouts(this.listProjects(), this.fichitasByProject(), config.poolAmount);
    },

    standings() {
      const config = this.hasRound() ? configOf() : defaults;
      return standings(this.listProjects(), this.fichitasByProject(), config.poolAmount);
    },

    setPending(telegramUserId, kind, payload, ttlMs) {
      const expires = Date.now() + ttlMs;
      db.prepare(
        `INSERT INTO pending (telegram_user_id, kind, payload, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (telegram_user_id) DO UPDATE SET kind = excluded.kind, payload = excluded.payload, expires_at = excluded.expires_at`,
      ).run(telegramUserId, kind, payload, expires);
    },

    takePending(telegramUserId, kind) {
      const row = db.prepare("SELECT kind, payload, expires_at FROM pending WHERE telegram_user_id = ?").get(telegramUserId) as
        | { kind: string; payload: string; expires_at: number }
        | undefined;
      if (!row || row.kind !== kind) return null;
      db.prepare("DELETE FROM pending WHERE telegram_user_id = ?").run(telegramUserId);
      if (row.expires_at < Date.now()) return null;
      return { kind: row.kind, payload: row.payload };
    },

    recordPayout(entry) {
      db.prepare(
        "INSERT INTO payouts (project_id, recipient, amount, tx_hash, dry_run, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(entry.projectId, entry.recipient, entry.amount.toString(), entry.txHash, entry.dryRun ? 1 : 0, new Date().toISOString());
    },

    livePaidRecipients() {
      const rows = db.prepare("SELECT recipient FROM payouts WHERE dry_run = 0 AND tx_hash IS NOT NULL").all() as Array<{
        recipient: string;
      }>;
      return new Set(rows.map((row) => row.recipient.toLowerCase()));
    },

    close() {
      db.close();
    },
  };

  return session;
}
