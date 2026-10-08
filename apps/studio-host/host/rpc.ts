// Client for upstream rhwp-studio's embed RPC on the same top-level window. Studio accepts
// legacy `rhwp-request` messages from itself when it is not inside an iframe, on any origin.

export interface StudioDocumentState {
  schemaVersion: number;
  format: string;
  dirty: boolean;
  pageCount: number;
  documentEpoch: number;
  changeSeq: number;
}

export interface StudioRpc {
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
}

interface RpcWindow {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown, targetOrigin: string): void;
}

export function createStudioRpc(target: RpcWindow): StudioRpc {
  let nextId = 1;
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();

  target.addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== target || message?.type !== 'rhwp-response') return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(String(message.error)));
    else request.resolve(message.result);
  });

  return {
    request<T>(method: string, params: Record<string, unknown> = {}) {
      const id = `hop-${nextId++}`;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        target.postMessage({ type: 'rhwp-request', id, method, params }, '*');
      });
    },
  };
}

/** The legacy transport serializes exported bytes as a number array. */
export function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new Error('studio did not return document bytes');
}

export async function exportDocument(rpc: StudioRpc, format: 'hwp' | 'hwpx'): Promise<Uint8Array> {
  return toBytes(await rpc.request(format === 'hwpx' ? 'exportHwpx' : 'exportHwp'));
}
