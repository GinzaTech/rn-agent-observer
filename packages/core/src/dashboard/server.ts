import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DASHBOARD_CONTENT_SECURITY_POLICY,
  renderOfflineDashboard,
  type DashboardReport,
} from './report.js';

export interface DashboardServerOptions {
  host?: '127.0.0.1' | '::1';
  port?: number;
  signal?: AbortSignal;
}

export interface DashboardServerHandle {
  host: '127.0.0.1' | '::1';
  port: number;
  origin: string;
  url: string;
  close: () => Promise<void>;
}

const applySecurityHeaders = (
  response: ServerResponse,
  contentType: string,
  contentLength: number,
): void => {
  response.setHeader(
    'Content-Security-Policy',
    DASHBOARD_CONTENT_SECURITY_POLICY,
  );
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', String(contentLength));
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader(
    'Permissions-Policy',
    'camera=(), geolocation=(), microphone=(), usb=()',
  );
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
};

const end = (
  response: ServerResponse,
  status: number,
  body: string,
  method: string,
  contentType = 'text/plain; charset=utf-8',
): void => {
  const bytes = Buffer.byteLength(body, 'utf8');
  response.statusCode = status;
  applySecurityHeaders(response, contentType, bytes);
  response.end(method === 'HEAD' ? undefined : body);
};

export const startReadOnlyDashboardServer = async (
  report: DashboardReport,
  options: DashboardServerOptions = {},
): Promise<DashboardServerHandle> => {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new TypeError(
      'Dashboard server host must be a numeric loopback address',
    );
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError(
      'Dashboard server port must be an integer from 0 to 65535',
    );
  }
  if (options.signal?.aborted) {
    throw new Error('Dashboard server start was aborted');
  }

  const html = renderOfflineDashboard(report);
  const allowedHosts = new Set<string>();
  const server = createServer((request, response) => {
    const method = request.method ?? 'GET';
    const requestTarget = request.url ?? '/';
    if (requestTarget.length > 2_048) {
      end(response, 414, 'Request target too long\n', method);
      return;
    }
    const requestHost = request.headers.host?.toLowerCase();
    if (!requestHost || !allowedHosts.has(requestHost)) {
      end(response, 421, 'Misdirected request\n', method);
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      end(response, 405, 'Method not allowed\n', method);
      return;
    }
    let url: URL;
    try {
      url = new URL(requestTarget, 'http://loopback.invalid');
    } catch {
      end(response, 400, 'Bad request target\n', method);
      return;
    }
    if (url.search || url.hash) {
      end(response, 404, 'Not found\n', method);
      return;
    }
    if (url.pathname === '/healthz') {
      end(response, 200, 'ok\n', method);
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      end(response, 200, html, method, 'text/html; charset=utf-8');
      return;
    }
    end(response, 404, 'Not found\n', method);
  });
  server.maxHeadersCount = 32;
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address() as AddressInfo | null;
  if (!address) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Dashboard server did not expose a listening address');
  }
  const formattedHost = host === '::1' ? '[::1]' : host;
  const origin = `http://${formattedHost}:${address.port}`;
  allowedHosts.add(`${formattedHost}:${address.port}`.toLowerCase());
  if (address.port === 80) allowedHosts.add(formattedHost.toLowerCase());

  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    options.signal?.removeEventListener('abort', onAbort);
    server.closeIdleConnections();
    closePromise = new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    return closePromise;
  };
  const onAbort = (): void => {
    void close().catch(() => undefined);
  };
  if (options.signal?.aborted) {
    await close();
    throw new Error('Dashboard server start was aborted');
  }
  options.signal?.addEventListener('abort', onAbort, { once: true });

  return {
    host,
    port: address.port,
    origin,
    url: `${origin}/`,
    close,
  };
};
