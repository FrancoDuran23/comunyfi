import { getAddress, isAddress } from "viem";
import { planPayouts, standings } from "./allocation.js";
import {
  AllocationError,
  AllocationErrorCode,
  type Attendee,
  type PayoutLine,
  type Project,
  type SessionConfig,
  type Standing,
} from "./types.js";

const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface Session {
  readonly config: SessionConfig;
  addProject(project: Project): void;
  registerAttendee(attendee: Attendee): void;
  allocate(lumaGuestId: string, projectId: string, fichitas: number): void;
  approve(): void;
  isApproved(): boolean;
  attendeeByTelegram(telegramUserId: number): Attendee | undefined;
  attendeeByLuma(lumaGuestId: string): Attendee | undefined;
  remainingFichitas(lumaGuestId: string): number;
  allocationOf(lumaGuestId: string, projectId: string): number;
  listProjects(): Project[];
  listAttendees(): Attendee[];
  fichitasByProject(): Map<string, number>;
  plan(): PayoutLine[];
  standings(): Standing[];
}

function assertConfig(config: SessionConfig): void {
  if (config.poolAmount < 0n) {
    throw new AllocationError(AllocationErrorCode.INVALID_CONFIG, "El pozo no puede ser negativo");
  }
  if (!Number.isInteger(config.fichitasPerAttendee) || config.fichitasPerAttendee <= 0) {
    throw new AllocationError(
      AllocationErrorCode.INVALID_CONFIG,
      "Las fichitas por asistente deben ser un entero positivo",
    );
  }
  if (!Number.isInteger(config.maxFichitasPerProject) || config.maxFichitasPerProject <= 0) {
    throw new AllocationError(
      AllocationErrorCode.INVALID_CONFIG,
      "El tope por proyecto debe ser un entero positivo",
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
  const id = project.id.trim();
  const name = project.name.trim();
  const summary = project.summary.trim();
  if (!PROJECT_ID.test(id) || name.length === 0 || summary.length === 0) {
    throw new AllocationError(
      AllocationErrorCode.INVALID_PROJECT,
      "El proyecto necesita id (a-z, 0-9, guiones), nombre y resumen",
    );
  }
  if (!isAddress(project.recipient)) {
    throw new AllocationError(AllocationErrorCode.INVALID_PROJECT, "El destinatario del proyecto no es una dirección");
  }
  const recipient = getAddress(project.recipient);
  if (recipient === "0x0000000000000000000000000000000000000000") {
    throw new AllocationError(AllocationErrorCode.INVALID_PROJECT, "El destinatario no puede ser la dirección cero");
  }
  return { id, name, summary, recipient };
}

export function createSession(config: SessionConfig): Session {
  assertConfig(config);

  const projects = new Map<string, Project>();
  const attendees = new Map<string, Attendee>();
  const telegramIndex = new Map<number, string>();
  const allocations = new Map<string, Map<string, number>>();
  let approved = false;

  function freezeGuard(): void {
    if (approved) {
      throw new AllocationError(
        AllocationErrorCode.SESSION_FROZEN,
        "La votación está cerrada: el pozo ya fue aprobado",
      );
    }
  }

  function spentBy(lumaGuestId: string): number {
    const votes = allocations.get(lumaGuestId);
    if (!votes) return 0;
    let total = 0;
    for (const amount of votes.values()) total += amount;
    return total;
  }

  return {
    config,

    addProject(project) {
      freezeGuard();
      const normalized = normalizeProject(project);
      if (projects.has(normalized.id)) {
        throw new AllocationError(AllocationErrorCode.DUPLICATE_PROJECT, `El proyecto ${normalized.id} ya existe`);
      }
      projects.set(normalized.id, normalized);
    },

    registerAttendee(attendee) {
      freezeGuard();
      const lumaGuestId = attendee.lumaGuestId.trim();
      const displayName = attendee.displayName.trim();
      if (lumaGuestId.length === 0 || displayName.length === 0) {
        throw new AllocationError(
          AllocationErrorCode.INVALID_ATTENDEE,
          "El asistente necesita invitado de Luma y nombre",
        );
      }
      if (!Number.isInteger(attendee.telegramUserId) || attendee.telegramUserId <= 0) {
        throw new AllocationError(AllocationErrorCode.INVALID_ATTENDEE, "El usuario de Telegram no es válido");
      }
      if (attendees.has(lumaGuestId)) {
        throw new AllocationError(
          AllocationErrorCode.DUPLICATE_ATTENDEE,
          "Ese check-in de Luma ya recibió fichitas",
        );
      }
      if (telegramIndex.has(attendee.telegramUserId)) {
        throw new AllocationError(
          AllocationErrorCode.DUPLICATE_TELEGRAM,
          "Ese Telegram ya está vinculado a un asistente",
        );
      }
      const record: Attendee = {
        lumaGuestId,
        telegramUserId: attendee.telegramUserId,
        displayName,
      };
      attendees.set(lumaGuestId, record);
      telegramIndex.set(attendee.telegramUserId, lumaGuestId);
      allocations.set(lumaGuestId, new Map());
    },

    allocate(lumaGuestId, projectId, fichitas) {
      freezeGuard();
      const guestId = lumaGuestId.trim();
      if (!attendees.has(guestId)) {
        throw new AllocationError(
          AllocationErrorCode.UNKNOWN_ATTENDEE,
          "Primero hay que vincular el check-in de Luma",
        );
      }
      const project = projects.get(projectId.trim());
      if (!project) {
        throw new AllocationError(AllocationErrorCode.UNKNOWN_PROJECT, "Ese proyecto no está en la ronda");
      }
      if (!Number.isInteger(fichitas) || fichitas <= 0) {
        throw new AllocationError(
          AllocationErrorCode.INVALID_AMOUNT,
          "Las fichitas tienen que ser un entero positivo",
        );
      }

      const votes = allocations.get(guestId);
      if (!votes) {
        throw new AllocationError(AllocationErrorCode.UNKNOWN_ATTENDEE, "Asistente sin presupuesto");
      }
      const current = votes.get(project.id) ?? 0;
      if (current + fichitas > config.maxFichitasPerProject) {
        throw new AllocationError(
          AllocationErrorCode.PROJECT_CAP_EXCEEDED,
          `Tope de ${config.maxFichitasPerProject} fichitas por proyecto`,
        );
      }
      if (spentBy(guestId) + fichitas > config.fichitasPerAttendee) {
        throw new AllocationError(
          AllocationErrorCode.BUDGET_EXCEEDED,
          `Te quedan ${config.fichitasPerAttendee - spentBy(guestId)} fichitas`,
        );
      }
      votes.set(project.id, current + fichitas);
    },

    approve() {
      if (approved) {
        throw new AllocationError(AllocationErrorCode.ALREADY_APPROVED, "El pozo ya estaba aprobado");
      }
      approved = true;
    },

    isApproved() {
      return approved;
    },

    attendeeByTelegram(telegramUserId) {
      const guestId = telegramIndex.get(telegramUserId);
      return guestId ? attendees.get(guestId) : undefined;
    },

    attendeeByLuma(lumaGuestId) {
      return attendees.get(lumaGuestId.trim());
    },

    remainingFichitas(lumaGuestId) {
      const guestId = lumaGuestId.trim();
      if (!attendees.has(guestId)) {
        throw new AllocationError(AllocationErrorCode.UNKNOWN_ATTENDEE, "Asistente desconocido");
      }
      return config.fichitasPerAttendee - spentBy(guestId);
    },

    allocationOf(lumaGuestId, projectId) {
      return allocations.get(lumaGuestId.trim())?.get(projectId.trim()) ?? 0;
    },

    listProjects() {
      return [...projects.values()];
    },

    listAttendees() {
      return [...attendees.values()];
    },

    fichitasByProject() {
      const totals = new Map<string, number>();
      for (const project of projects.values()) totals.set(project.id, 0);
      for (const votes of allocations.values()) {
        for (const [projectId, amount] of votes) {
          totals.set(projectId, (totals.get(projectId) ?? 0) + amount);
        }
      }
      return totals;
    },

    plan() {
      return planPayouts([...projects.values()], this.fichitasByProject(), config.poolAmount);
    },

    standings() {
      return standings([...projects.values()], this.fichitasByProject(), config.poolAmount);
    },
  };
}
