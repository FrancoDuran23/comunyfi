import type { LumaValidator } from "../luma/checkin.js";
import type { Attendee } from "./types.js";
import type { Session } from "./session.js";

/**
 * Entrega el presupuesto de fichitas una sola vez por invitado de Luma
 * y una sola vez por usuario de Telegram. La sesión rechaza el duplicado.
 */
export async function claimFichitas(input: {
  session: Session;
  luma: LumaValidator;
  eventId: string;
  guestId: string;
  telegramUserId: number;
  displayName?: string;
}): Promise<Attendee> {
  const checkIn = await input.luma.assertCheckedIn(input.guestId, input.eventId);
  const displayName = input.displayName?.trim() || checkIn.name;
  const attendee: Attendee = {
    lumaGuestId: checkIn.guestId,
    telegramUserId: input.telegramUserId,
    displayName,
  };
  input.session.registerAttendee(attendee);
  return attendee;
}
