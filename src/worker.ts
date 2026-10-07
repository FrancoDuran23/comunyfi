import { DurableObject } from "cloudflare:workers";
import { wrapDurableSql } from "./store/durable-sql.js";
import { forwardToRoom } from "./worker/forward.js";
import { openWorkerRoom, type WorkerBindings, type WorkerRoom } from "./worker/room.js";

export interface WorkerEnv extends WorkerBindings {
  COMUNYFI: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
}

export class ComunyfiState extends DurableObject<WorkerEnv> {
  #room: WorkerRoom | undefined;

  async fetch(request: Request): Promise<Response> {
    try {
      this.#room ??= openWorkerRoom(this.env, wrapDurableSql(this.ctx.storage.sql));
      return await this.#room.handle(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error";
      return new Response(message, { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  }
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return forwardToRoom(request, env.COMUNYFI);
  },
};
