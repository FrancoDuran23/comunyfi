export type SqlBind = string | number | bigint | null | Uint8Array;

export interface SqlRunResult {
  changes: number;
}

/** Subconjunto síncrono que usan la sesión y el adaptador del Durable Object. */
export interface SqlStatement {
  get(...params: SqlBind[]): unknown;
  all(...params: SqlBind[]): unknown[];
  run(...params: SqlBind[]): SqlRunResult;
}

export interface SqlDb {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}

/** Parte un script de DDL. Las sentencias de Comunyfi no tienen `;` adentro de un string. */
export function splitSqlScript(script: string): string[] {
  return script
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
