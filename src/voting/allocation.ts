import type { PayoutLine, Project, Standing } from "./types.js";

/**
 * Reparte el pozo en proporción a las fichitas.
 * El resto de la división entera (wei) se asigna de a uno a los proyectos
 * con mayor residuo. Si empatan, gana el id más chico. La suma cierra exacta.
 */
export function planPayouts(
  projects: readonly Project[],
  fichitasByProject: ReadonlyMap<string, number>,
  poolAmount: bigint,
): PayoutLine[] {
  if (poolAmount < 0n) {
    throw new Error("El pozo no puede ser negativo");
  }

  const active = projects
    .map((project) => ({ project, fichitas: fichitasByProject.get(project.id) ?? 0 }))
    .filter((row) => row.fichitas > 0);

  if (poolAmount === 0n || active.length === 0) return [];

  const total = active.reduce((sum, row) => sum + BigInt(row.fichitas), 0n);
  const shares = active.map((row) => {
    const product = poolAmount * BigInt(row.fichitas);
    return {
      ...row,
      amount: product / total,
      remainder: product % total,
    };
  });

  let leftover = poolAmount - shares.reduce((sum, row) => sum + row.amount, 0n);
  const bonus = new Map<string, bigint>();
  const byRemainder = [...shares].sort((a, b) => {
    if (a.remainder === b.remainder) {
      return a.project.id < b.project.id ? -1 : 1;
    }
    return a.remainder > b.remainder ? -1 : 1;
  });

  for (const row of byRemainder) {
    if (leftover === 0n) break;
    bonus.set(row.project.id, 1n);
    leftover -= 1n;
  }

  return shares
    .map((row) => ({
      projectId: row.project.id,
      projectName: row.project.name,
      recipient: row.project.recipient,
      fichitas: row.fichitas,
      amount: row.amount + (bonus.get(row.project.id) ?? 0n),
    }))
    .sort((a, b) => (a.projectId < b.projectId ? -1 : 1));
}

export function standings(
  projects: readonly Project[],
  fichitasByProject: ReadonlyMap<string, number>,
  poolAmount: bigint,
): Standing[] {
  const payouts = new Map(planPayouts(projects, fichitasByProject, poolAmount).map((line) => [line.projectId, line.amount]));
  return projects.map((project) => ({
    projectId: project.id,
    projectName: project.name,
    summary: project.summary,
    recipient: project.recipient,
    fichitas: fichitasByProject.get(project.id) ?? 0,
    amount: payouts.get(project.id) ?? 0n,
  }));
}
