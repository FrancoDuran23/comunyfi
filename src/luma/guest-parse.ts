import type { GuestRecord } from "./checkin.js";

export function parseGuestsJson(raw: string): GuestRecord[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("El archivo de invitados tiene que ser una lista");
  }
  return parsed.map((entry, index) => parseGuest(entry, index));
}

export function parseGuestsCsv(raw: string): GuestRecord[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const header = lines[0]?.split(",").map((cell) => cell.trim().toLowerCase()) ?? [];
  const emailAt = header.indexOf("email");
  const nameAt = header.indexOf("name");
  const idAt = header.indexOf("guestid");
  const checkedAt = header.indexOf("checkedin");
  if (emailAt < 0 || nameAt < 0 || idAt < 0 || checkedAt < 0) {
    throw new Error("El CSV necesita columnas email,name,guestId,checkedIn");
  }
  return lines.slice(1).map((line, index) => {
    const cells = line.split(",").map((cell) => cell.trim());
    return parseGuest(
      {
        email: cells[emailAt],
        name: cells[nameAt],
        guestId: cells[idAt],
        checkedIn: cells[checkedAt],
      },
      index + 1,
    );
  });
}

function parseGuest(value: unknown, index: number): GuestRecord {
  if (!value || typeof value !== "object") {
    throw new Error(`El invitado #${index} no es un objeto`);
  }
  const entry = value as Partial<Record<"email" | "name" | "guestId" | "checkedIn", unknown>>;
  if (typeof entry.email !== "string" || typeof entry.name !== "string" || typeof entry.guestId !== "string") {
    throw new Error(`El invitado #${index} necesita email, name y guestId`);
  }
  return {
    email: entry.email,
    name: entry.name,
    guestId: entry.guestId,
    checkedIn: isCheckedIn(entry.checkedIn),
  };
}

function isCheckedIn(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "si" || normalized === "sí";
  }
  return false;
}
