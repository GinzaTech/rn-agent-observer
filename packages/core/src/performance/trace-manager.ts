import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Trace } from '@rn-agent-observer/schemas';
import type { AdbClient } from '../adb/adb-client.js';
import type { ArtifactManager } from '../artifacts/artifact-manager.js';
import { ObserverError } from '../errors.js';

interface ActiveTrace extends Trace {
  pid: string;
  remotePath: string;
  sessionId?: string;
}

export class TraceManager {
  private readonly active = new Map<string, ActiveTrace>();
  private readonly stateDirectory: string;

  constructor(
    private readonly adb: AdbClient,
    private readonly artifacts: ArtifactManager,
  ) {
    this.stateDirectory = join(this.artifacts.root, 'active-traces');
    mkdirSync(this.stateDirectory, { recursive: true });
  }

  private statePath(traceId: string): string {
    return join(this.stateDirectory, `${traceId}.json`);
  }

  async start(durationMs: number, sessionId?: string): Promise<Trace> {
    const client = await this.adb.selected();
    const id = randomUUID();
    const remotePath = `/data/misc/perfetto-traces/rn-observer-${id}.perfetto-trace`;
    const durationSeconds = Math.max(
      1,
      Math.ceil(Math.min(durationMs, 300_000) / 1000),
    );
    const pid = await client.shell([
      'perfetto',
      '--background',
      '-o',
      remotePath,
      '-t',
      `${durationSeconds}s`,
      'sched',
      'freq',
      'idle',
      'am',
      'wm',
      'gfx',
      'view',
      'binder_driver',
    ]);
    const trace: ActiveTrace = {
      id,
      source: 'android-perfetto',
      startedAt: new Date().toISOString(),
      pid: pid.trim().split(/\s+/).at(-1) ?? '',
      remotePath,
      ...(sessionId ? { sessionId } : {}),
    };
    this.active.set(id, trace);
    writeFileSync(this.statePath(id), JSON.stringify(trace));
    return trace;
  }

  async stop(traceId: string): Promise<Trace> {
    const statePath = this.statePath(traceId);
    const trace =
      this.active.get(traceId) ??
      (existsSync(statePath)
        ? (JSON.parse(readFileSync(statePath, 'utf8')) as ActiveTrace)
        : undefined);
    if (!trace) {
      throw new ObserverError(
        'TRACE_NOT_ACTIVE',
        `Trace ${traceId} is not active`,
        true,
      );
    }
    const client = await this.adb.selected();
    if (trace.pid) {
      await client.shell(['kill', '-INT', trace.pid]).catch(() => undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
    const artifact = this.artifacts.write('trace', Buffer.alloc(0), {
      ...(trace.sessionId ? { sessionId: trace.sessionId } : {}),
      extension: '.perfetto-trace',
      mimeType: 'application/octet-stream',
    });
    await client.text(['pull', trace.remotePath, artifact.path], 60_000);
    await client.shell(['rm', '-f', trace.remotePath]).catch(() => undefined);
    this.active.delete(traceId);
    if (existsSync(statePath)) unlinkSync(statePath);
    return {
      id: trace.id,
      source: trace.source,
      startedAt: trace.startedAt,
      stoppedAt: new Date().toISOString(),
      artifactId: artifact.id,
    };
  }
}
