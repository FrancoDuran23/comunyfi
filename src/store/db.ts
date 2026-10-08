import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "./schema.js";
import type { SqlBind, SqlDb } from "./sql.js";

export function openDatabase(path: string): SqlDb {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  const wrapped = wrapNodeSqlite(db);
  wrapped.exec(SCHEMA);
  return wrapped;
}

export function wrapNodeSqlite(db: DatabaseSync): SqlDb {
  return {
    exec(sql) {
      db.exec(sql);
    },
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        get(...params: SqlBind[]) {
          return statement.get(...(params as never[]));
        },
        all(...params: SqlBind[]) {
          return statement.all(...(params as never[])) as unknown[];
        },
        run(...params: SqlBind[]) {
          const result = statement.run(...(params as never[]));
          return { changes: Number(result.changes) };
        },
      };
    },
    close() {
      db.close();
    },
  };
}
