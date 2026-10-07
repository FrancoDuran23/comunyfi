import { openDatabase } from "../store/db.js";
import { sessionFromDb, type Session } from "./session.js";
import type { SessionConfig } from "./types.js";

export function openStoredSession(dbPath: string, defaults: SessionConfig): Session {
  return sessionFromDb(openDatabase(dbPath), defaults);
}

/** Ronda en memoria, ya abierta, para los tests de fichitas. */
export function createSession(config: SessionConfig): Session {
  const session = openStoredSession(":memory:", config);
  session.ensureRound("ensayo", { status: "open" });
  return session;
}
