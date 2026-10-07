import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { packageRoot } from "../paths.js";
import type { GuestRecord } from "./checkin.js";
import { parseGuestsCsv, parseGuestsJson } from "./guest-parse.js";

export { parseGuestsCsv, parseGuestsJson } from "./guest-parse.js";

export function demoGuestsPath(): string {
  return join(packageRoot(), "data", "guests.example.json");
}

export async function loadGuestsFile(filePath: string): Promise<GuestRecord[]> {
  const raw = await readFile(filePath, "utf8");
  if (filePath.endsWith(".csv")) return parseGuestsCsv(raw);
  return parseGuestsJson(raw);
}
