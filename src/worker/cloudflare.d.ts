declare module "cloudflare:workers" {
  export interface DurableObjectState {
    storage: {
      sql: {
        exec(
          query: string,
          ...bindings: Array<string | number | bigint | null | Uint8Array>
        ): {
          readonly rowsWritten: number;
          toArray(): Array<Record<string, unknown>>;
        };
      };
    };
  }

  export class DurableObject<Env = unknown> {
    ctx: DurableObjectState;
    env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}
