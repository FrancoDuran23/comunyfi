import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { packageRoot } from "./paths.js";
import { parseProjects } from "./projects-data.js";
import type { Project } from "./voting/types.js";

export { parseProjects } from "./projects-data.js";

export async function loadProjectsFile(filePath: string): Promise<Project[]> {
  const raw = await readFile(filePath, "utf8");
  return parseProjects(JSON.parse(raw));
}

export function demoProjectsPath(): string {
  return join(packageRoot(), "data", "projects.example.json");
}
