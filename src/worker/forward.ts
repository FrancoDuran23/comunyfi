/** Un solo objeto: todas las lecturas y los updates pegan al mismo estado. */
export const ROOM_NAME = "comunyfi";

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export function forwardToRoom(request: Request, namespace: DurableObjectNamespaceLike): Promise<Response> {
  const id = namespace.idFromName(ROOM_NAME);
  return namespace.get(id).fetch(request);
}
