/**
 * Placeholder del check-in de Luma.
 *
 * El evento real valida contra la API de Luma (guest id + event id, estado
 * checked-in). Este módulo no hace esa llamada: acepta una lista explícita
 * o, solo en demos, ids con prefijo `guest_`.
 */

export interface LumaCheckIn {
  guestId: string;
  eventId: string;
  name: string;
  checkedIn: true;
}

export const LumaErrorCode = {
  MISCONFIGURED: "MISCONFIGURED",
  UNKNOWN_GUEST: "UNKNOWN_GUEST",
  NOT_CHECKED_IN: "NOT_CHECKED_IN",
  WRONG_EVENT: "WRONG_EVENT",
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
  assertCheckedIn(guestId: string, eventId: string): Promise<LumaCheckIn>;
}

export interface LumaValidatorOptions {
  eventId: string;
  /** Invitados que ya figuran como checked-in. El nombre visible es el propio id. */
  checkedInGuestIds?: ReadonlySet<string>;
  /**
   * Acepta `guest_<nombre>` sin lista. Sirve para ensayar el bot en local.
   * No usar en el evento.
   */
  allowPlaceholderPrefix?: boolean;
}

const PLACEHOLDER_GUEST = /^guest_[a-z0-9][a-z0-9_-]{0,40}$/i;

export function createLumaValidator(options: LumaValidatorOptions): LumaValidator {
  const eventId = options.eventId.trim();
  const allowlist = options.checkedInGuestIds ?? new Set<string>();
  const allowPlaceholder = options.allowPlaceholderPrefix === true;

  if (eventId.length === 0) {
    throw new LumaValidationError(LumaErrorCode.MISCONFIGURED, "Falta el id del evento de Luma");
  }

  return {
    async assertCheckedIn(guestId: string, requestedEventId: string) {
      const id = guestId.trim();
      const event = requestedEventId.trim();
      if (event !== eventId) {
        throw new LumaValidationError(LumaErrorCode.WRONG_EVENT, "Ese check-in es de otro evento");
      }
      if (id.length === 0) {
        throw new LumaValidationError(LumaErrorCode.UNKNOWN_GUEST, "Falta el id de invitado de Luma");
      }

      if (allowlist.has(id)) {
        return { guestId: id, eventId, name: id, checkedIn: true };
      }

      if (allowPlaceholder && PLACEHOLDER_GUEST.test(id)) {
        const name = id.slice("guest_".length).replace(/[-_]/g, " ");
        return { guestId: id, eventId, name, checkedIn: true };
      }

      if (!allowPlaceholder && allowlist.size === 0) {
        throw new LumaValidationError(
          LumaErrorCode.MISCONFIGURED,
          "Luma no está configurado: cargá LUMA_CHECKED_IN_GUESTS o el modo demo",
        );
      }

      throw new LumaValidationError(
        LumaErrorCode.NOT_CHECKED_IN,
        "Luma no muestra a esa persona como presente en el evento",
      );
    },
  };
}
