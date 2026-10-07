import { getAddress, isAddress, type Address } from "viem";
import type { Project } from "./voting/types.js";

interface ProjectFileEntry {
  id: string;
  name: string;
  summary: string;
  recipient: string;
}

function parseEntry(value: unknown, index: number): Project {
  if (!value || typeof value !== "object") {
    throw new Error(`El proyecto #${index} no es un objeto`);
  }
  const entry = value as Partial<ProjectFileEntry>;
  if (typeof entry.id !== "string" || typeof entry.name !== "string" || typeof entry.summary !== "string") {
    throw new Error(`El proyecto #${index} necesita id, name y summary`);
  }
  if (typeof entry.recipient !== "string" || !isAddress(entry.recipient)) {
    throw new Error(`El proyecto ${entry.id} tiene un destinatario inválido`);
  }
  const recipient: Address = getAddress(entry.recipient);
  return { id: entry.id, name: entry.name, summary: entry.summary, recipient };
}

export function parseProjects(parsed: unknown): Project[] {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("El archivo de proyectos tiene que ser una lista con al menos uno");
  }
  return parsed.map((entry, index) => parseEntry(entry, index));
}
