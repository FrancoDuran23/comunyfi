/**
 * Check-in de Luma por mail.
 *
 * Con LUMA_API_KEY y LUMA_EVENT_ID consulta
 * GET https://public-api.luma.com/v1/events/guests/get
 * (el id puede ser el mail). Sin clave, usa un CSV o JSON local.
 *
 * Una persona está adentro si tiene algún ticket con checked_in_at.
 */

export interface LumaCheckIn {
  guestId: string;
  eventId: string;
  email: string;
  name: string;
  checkedIn: true;
}

export interface GuestRecord {
  email: string;
  name: string;
  guestId: string;
  checkedIn: boolean;
}

export const LumaErrorCode = {
  MISCONFIGURED: "MISCONFIGURED",
  UNKNOWN_GUEST: "UNKNOWN_GUEST",
  NOT_CHECKED_IN: "NOT_CHECKED_IN",
  WRONG_EVENT: "WRONG_EVENT",
  UNAVAILABLE: "UNAVAILABLE",
} as const;

export type LumaErrorCode = (typeof LumaErrorCode)[keyof typeof LumaErrorCode];

export class LumaValidationError extends Error {
  readonly code: LumaErrorCode;

  constructor(code: LumaErrorCode, message: string) {
    super(message);
    this.name = "LumaValidationError";
    this.code = code;
  }
}

export interface LumaValidator {
  readonly source: "luma-api" | "archivo" | "ninguno";
  assertCheckedInByEmail(email: string): Promise<LumaCheckIn>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return EMAIL.test(email) ? email : null;
}

export function createGuestListValidator(eventId: string, guests: readonly GuestRecord[]): LumaValidator {
  const id = eventId.trim();
  if (id.length === 0) {
    throw new LumaValidationError(LumaErrorCode.MISCONFIGURED, "Falta el id del evento de Luma");
  }
  const byEmail = new Map<string, GuestRecord>();
  for (const guest of guests) {
    const email = normalizeEmail(guest.email);
    if (!email || guest.guestId.trim().length === 0 || guest.name.trim().length === 0) {
      throw new LumaValidationError(LumaErrorCode.MISCONFIGURED, "Hay un invitado local sin mail, nombre o id");
    }
    byEmail.set(email, { ...guest, email, guestId: guest.guestId.trim(), name: guest.name.trim() });
  }

  return {
    source: "archivo",
    async assertCheckedInByEmail(rawEmail: string) {
      const email = normalizeEmail(rawEmail);
      if (!email) {
        throw new LumaValidationError(LumaErrorCode.UNKNOWN_GUEST, "Eso no parece un mail.");
      }
      const guest = byEmail.get(email);
      if (!guest) {
        throw new LumaValidationError(LumaErrorCode.UNKNOWN_GUEST, "Ese mail no figura en la lista del evento.");
      }
      if (!guest.checkedIn) {
        throw new LumaValidationError(
          LumaErrorCode.NOT_CHECKED_IN,
          "Estás en la lista, pero todavía no hiciste el check-in en la puerta.",
        );
      }
      return { guestId: guest.guestId, eventId: id, email, name: guest.name, checkedIn: true };
    },
  };
}

export function createLumaApiValidator(options: {
  eventId: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): LumaValidator {
  const eventId = options.eventId.trim();
  const apiKey = options.apiKey.trim();
  if (eventId.length === 0 || apiKey.length === 0) {
    throw new LumaValidationError(LumaErrorCode.MISCONFIGURED, "Faltan LUMA_EVENT_ID o LUMA_API_KEY");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? "https://public-api.luma.com";

  return {
    source: "luma-api",
    async assertCheckedInByEmail(rawEmail: string) {
      const email = normalizeEmail(rawEmail);
      if (!email) {
        throw new LumaValidationError(LumaErrorCode.UNKNOWN_GUEST, "Eso no parece un mail.");
      }
      const url = new URL("/v1/events/guests/get", baseUrl);
      url.searchParams.set("event_id", eventId);
      url.searchParams.set("id", email);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { accept: "application/json", "x-luma-api-key": apiKey },
        });
      } catch {
        throw new LumaValidationError(LumaErrorCode.UNAVAILABLE, "No pude consultar Luma. Intentá de nuevo en un rato.");
      }
      if (response.status === 404) {
        throw new LumaValidationError(LumaErrorCode.UNKNOWN_GUEST, "Ese mail no figura en la lista del evento.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new LumaValidationError(LumaErrorCode.MISCONFIGURED, "Luma rechazó la API key. Revisá LUMA_API_KEY.");
      }
      if (response.status === 429) {
        throw new LumaValidationError(LumaErrorCode.UNAVAILABLE, "Luma está limitando las consultas. Esperá un minuto y reintentá.");
      }
      if (!response.ok) {
        throw new LumaValidationError(LumaErrorCode.UNAVAILABLE, "Luma respondió mal. Intentá de nuevo en un rato.");
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new LumaValidationError(LumaErrorCode.UNAVAILABLE, "Luma respondió algo que no es JSON.");
      }
      return parseLumaGuestPayload(body, eventId, email);
    },
  };
}

export function createClosedValidator(): LumaValidator {
  return {
    source: "ninguno",
    async assertCheckedInByEmail() {
      throw new LumaValidationError(
        LumaErrorCode.MISCONFIGURED,
        "Luma no está configurado. Hace falta LUMA_API_KEY o un archivo de invitados.",
      );
    },
  };
}

/** Acepta el GuestDetailed de la API o el mismo objeto adentro de `{ guest }`. */
export function parseLumaGuestPayload(body: unknown, eventId: string, requestedEmail: string): LumaCheckIn {
  const record = unwrapGuest(body);
  const email = typeof record.user_email === "string" ? normalizeEmail(record.user_email) : null;
  const guestId = typeof record.id === "string" ? record.id.trim() : "";
  if (!email || guestId.length === 0) {
    throw new LumaValidationError(LumaErrorCode.UNAVAILABLE, "La ficha de Luma vino incompleta.");
  }
  if (email !== requestedEmail) {
    throw new LumaValidationError(LumaErrorCode.UNKNOWN_GUEST, "Luma devolvió otro mail. No vinculé la cuenta.");
  }
  const approval = typeof record.approval_status === "string" ? record.approval_status : "";
  if (approval === "declined") {
    throw new LumaValidationError(LumaErrorCode.NOT_CHECKED_IN, "Esa inscripción figura como rechazada en Luma.");
  }
  const tickets = Array.isArray(record.event_tickets) ? record.event_tickets : [];
  const checkedIn = tickets.some((ticket) => {
    if (!ticket || typeof ticket !== "object") return false;
    const at = (ticket as { checked_in_at?: unknown }).checked_in_at;
    return typeof at === "string" && at.length > 0;
  });
  if (!checkedIn) {
    throw new LumaValidationError(
      LumaErrorCode.NOT_CHECKED_IN,
      "Estás en la lista, pero todavía no hiciste el check-in en la puerta.",
    );
  }
  return {
    guestId,
    eventId,
    email,
    name: guestName(record, email),
    checkedIn: true,
  };
}

function unwrapGuest(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") {
    throw new LumaValidationError(LumaErrorCode.UNAVAILABLE, "La ficha de Luma vino vacía.");
  }
  const record = body as Record<string, unknown>;
  if (record.guest && typeof record.guest === "object") {
    return record.guest as Record<string, unknown>;
  }
  return record;
}

function guestName(record: Record<string, unknown>, email: string): string {
  if (typeof record.user_name === "string" && record.user_name.trim().length > 0) {
    return record.user_name.trim();
  }
  const first = typeof record.user_first_name === "string" ? record.user_first_name.trim() : "";
  const last = typeof record.user_last_name === "string" ? record.user_last_name.trim() : "";
  const combined = `${first} ${last}`.trim();
  return combined.length > 0 ? combined : email;
}
