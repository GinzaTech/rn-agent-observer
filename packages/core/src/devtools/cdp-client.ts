import WebSocket from 'ws';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
}

/**
 * Minimal Chrome DevTools Protocol client over WebSocket.
 * Metro's inspector proxy requires a same-origin `Origin` header,
 * so the header is always derived from the target URL.
 */
export class CdpConnection {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly listeners = new Map<
    string,
    Array<(params: Record<string, unknown>) => void>
  >();
  private closed = false;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (data: WebSocket.RawData) => {
      this.handleMessage(data.toString('utf8'));
    });
    socket.on('close', () => this.rejectAllPending('Connection closed'));
    socket.on('error', (error: Error) => this.rejectAllPending(error.message));
  }

  static async connect(
    wsUrl: string,
    timeoutMs = 10_000,
  ): Promise<CdpConnection> {
    const origin = new URL(wsUrl).origin;
    const socket = new WebSocket(wsUrl, { headers: { origin } });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error(`CDP connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      socket.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return new CdpConnection(socket);
  }

  private handleMessage(raw: string): void {
    let message: {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
      params?: Record<string, unknown>;
    };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      return;
    }
    if (typeof message.id === 'number' && this.pending.has(message.id)) {
      const call = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        call?.reject(new Error(message.error.message ?? 'CDP error'));
      } else {
        call?.resolve(message.result ?? {});
      }
      return;
    }
    if (message.method) {
      const params = message.params ?? {};
      for (const listener of this.listeners.get(message.method) ?? []) {
        listener(params);
      }
    }
  }

  private rejectAllPending(reason: string): void {
    this.closed = true;
    for (const call of this.pending.values()) {
      call.reject(new Error(reason));
    }
    this.pending.clear();
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 10_000,
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('Connection closed'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(
    method: string,
    listener: (params: Record<string, unknown>) => void,
  ): void {
    const existing = this.listeners.get(method) ?? [];
    existing.push(listener);
    this.listeners.set(method, existing);
  }

  close(): void {
    this.closed = true;
    this.socket.close();
  }
}
