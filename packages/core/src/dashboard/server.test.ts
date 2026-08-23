import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { Session, TargetFingerprint } from '@rn-agent-observer/schemas';
import {
  buildDashboardReport,
  DASHBOARD_CONTENT_SECURITY_POLICY,
} from './report.js';
import { startReadOnlyDashboardServer } from './server.js';

const session: Session = {
  schemaVersion: '1.0',
  id: 'server-session',
  projectRoot: 'C:\\private',
  startedAt: '2026-08-22T00:00:00.000Z',
  stoppedAt: '2026-08-22T00:00:01.000Z',
  status: 'complete',
  artifactIds: [],
  artifacts: [],
  timeline: [],
};

const target: TargetFingerprint = {
  platform: 'android',
  deviceId: 'emulator-5554',
  appId: 'dev.rnagentobserver.demo',
};

const report = buildDashboardReport([
  { session, target },
  {
    session: {
      ...session,
      id: 'server-session-2',
      startedAt: '2026-08-22T00:01:00.000Z',
      stoppedAt: '2026-08-22T00:01:01.000Z',
    },
    target,
  },
]);

const requestWithHost = async (
  port: number,
  hostHeader: string,
): Promise<number | undefined> =>
  new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
        headers: { Host: hostHeader },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });

describe('read-only dashboard server', () => {
  it('binds only to loopback and serves GET/HEAD with security headers', async () => {
    const server = await startReadOnlyDashboardServer(report);
    try {
      const response = await fetch(server.url);
      const body = await response.text();
      const head = await fetch(server.url, { method: 'HEAD' });
      const post = await fetch(server.url, { method: 'POST', body: 'ignored' });
      const missing = await fetch(`${server.origin}/..%2Fprivate`);

      expect(server.host).toBe('127.0.0.1');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-security-policy')).toBe(
        DASHBOARD_CONTENT_SECURITY_POLICY,
      );
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(body).toContain('RN Agent Observer local report');
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      expect(post.status).toBe(405);
      expect(post.headers.get('allow')).toBe('GET, HEAD');
      expect(missing.status).toBe(404);
      expect(await requestWithHost(server.port, 'attacker.example')).toBe(421);
    } finally {
      await server.close();
      await server.close();
    }
  });

  it('rejects non-loopback binding and invalid ports', async () => {
    await expect(
      startReadOnlyDashboardServer(report, {
        host: '0.0.0.0' as unknown as '127.0.0.1',
      }),
    ).rejects.toThrow('numeric loopback');
    await expect(
      startReadOnlyDashboardServer(report, { port: 65_536 }),
    ).rejects.toThrow('0 to 65535');
  });
});
