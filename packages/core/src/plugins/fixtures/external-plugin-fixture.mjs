/* global process */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const protocol = 'rn-agent-observer-plugin-jsonrpc-stdio-v1';
const [, , pluginId, kind, providesJson, requiresJson] = process.argv;
const provides = JSON.parse(providesJson ?? '[]');
const requires = JSON.parse(requiresJson ?? '[]');

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function sendError(id, code, message) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`,
  );
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'plugin.initialize') {
    send(request.id, {
      protocol,
      pluginId,
      kind,
      apiVersion: 1,
    });
    return;
  }
  if (request.method === 'plugin.capabilities') {
    send(request.id, { provides, requires });
    return;
  }
  if (request.method === 'plugin.dispose') {
    send(request.id, { disposed: true });
    return;
  }
  if (
    request.method !== 'action.execute' &&
    request.method !== 'provider.collect'
  ) {
    sendError(request.id, -32601, 'method not found');
    return;
  }

  const mode = request.params?.mode ?? 'echo';
  if (mode === 'echo') {
    send(request.id, {
      requestId: request.id,
      cwd: process.cwd(),
      environment: {
        allowed: process.env.PLUGIN_ALLOWED ?? null,
        secret: process.env.PLUGIN_SECRET ?? null,
      },
      params: request.params,
    });
    return;
  }
  if (mode === 'stderr') {
    process.stderr.write(
      `${'noise '.repeat(100)} token=super-secret authorization=Bearer abc.def.ghi user@example.com`,
    );
    send(request.id, { wroteStderr: true });
    return;
  }
  if (mode === 'rpc-error') {
    sendError(request.id, 4100, 'token=rpc-secret failed');
    return;
  }
  if (mode === 'oversize') {
    send(request.id, { payload: 'x'.repeat(8192) });
    return;
  }
  if (mode === 'hang') {
    if (
      typeof request.params?.markerPath === 'string' &&
      typeof request.params?.readyPath === 'string'
    ) {
      const markerPath = request.params.markerPath;
      const readyPath = request.params.readyPath;
      const markerDelayMs =
        typeof request.params?.markerDelayMs === 'number'
          ? request.params.markerDelayMs
          : 1_500;
      const childCode = `
        const { writeFileSync } = require('node:fs');
        writeFileSync(${JSON.stringify(readyPath)}, String(process.pid));
        setTimeout(() => writeFileSync(${JSON.stringify(markerPath)}, 'orphan'), ${JSON.stringify(markerDelayMs)});
        setInterval(() => {}, 1_000);
      `;
      spawn(process.execPath, ['-e', childCode], {
        stdio: 'ignore',
        windowsHide: true,
      });
    }
    return;
  }
  if (mode === 'bad-capability') {
    send(request.id, { unexpected: true });
    return;
  }
  sendError(request.id, -32602, 'unknown fixture mode');
});

input.on('close', () => process.exit(0));
