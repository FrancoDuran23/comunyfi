import { splitSqlScript, type SqlBind, type SqlDb } from "./sql.js";

/**
 * Cursor síncrono de `ctx.storage.sql` (SQLite del Durable Object).
 * `rowsWritten` es lo que node:sqlite expone como `changes`.
 */
export interface SyncSqlCursor {
  readonly rowsWritten: number;
  toArray(): ReadonlyArray<Record<string, unknown>>;
}

export interface SyncSql {
  exec(query: string, ...bindings: SqlBind[]): SyncSqlCursor;
}

/** Adapta el SQL síncrono de Cloudflare al mismo prepare/get/all/run de la sesión. */
export function wrapDurableSql(sql: SyncSql): SqlDb {
  return {
    exec(script) {
      for (const statement of splitSqlScript(script)) sql.exec(statement);
    },
    prepare(query) {
      return {
        get(...params) {
          const rows = sql.exec(query, ...params).toArray();
          return rows[0];
        },
        all(...params) {
          return [...sql.exec(query, ...params).toArray()];
        },
        run(...params) {
          const cursor = sql.exec(query, ...params);
          const changes = cursor.rowsWritten;
          cursor.toArray();
          return { changes };
        },
      };
    },
    close() {},
  };
}
