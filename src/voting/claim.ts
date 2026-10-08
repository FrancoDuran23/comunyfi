import type { LumaValidator } from "../luma/checkin.js";
import type { Attendee } from "./types.js";
import type { Session } from "./session.js";

/**
 * Entrega el presupuesto una sola vez por mail de Luma y una sola vez por Telegram.
 * La sesión rechaza el duplicado.
 */
export async function claimFichitas(input: {
  session: Session;
  luma: LumaValidator;
  email: string;
  telegramUserId: number;
  displayName?: string;
}): Promise<Attendee> {
  const checkIn = await input.luma.assertCheckedInByEmail(input.email);
  const displayName = input.displayName?.trim() || checkIn.name;
  const attendee: Attendee = {
    lumaGuestId: checkIn.guestId,
    email: checkIn.email,
    telegramUserId: input.telegramUserId,
    displayName,
  };
  input.session.registerAttendee(attendee);
  return attendee;
}
