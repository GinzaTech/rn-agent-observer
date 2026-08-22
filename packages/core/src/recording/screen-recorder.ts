import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Artifact, Trace } from '@rn-agent-observer/schemas';
import type { AdbClient } from '../adb/adb-client.js';
import type { ArtifactManager } from '../artifacts/artifact-manager.js';
import { ObserverError } from '../errors.js';

interface ActiveRecording extends Trace {
  pid: string;
  remotePath: string;
  sessionId?: string;
}

export interface CompletedRecording {
  trace: Trace;
  artifact: Artifact;
  sessionId?: string;
}

/** Android screenrecord caps a single clip at 180 seconds. */
export const MAX_RECORDING_DURATION_MS = 180_000;

export function clampRecordingDuration(durationMs: number): number {
  return Math.max(1_000, Math.min(durationMs, MAX_RECORDING_DURATION_MS));
}

export class ScreenRecorder {
  private readonly stateDirectory: string;

  constructor(
    private readonly adb: AdbClient,
    private readonly artifacts: ArtifactManager,
  ) {
    this.stateDirectory = join(this.artifacts.root, 'active-recordings');
    mkdirSync(this.stateDirectory, { recursive: true });
  }

  private statePath(recordingId: string): string {
    return join(this.stateDirectory, `${recordingId}.json`);
  }

  async start(
    durationMs: number,
    sessionId?: string,
  ): Promise<ActiveRecording> {
    const clamped = clampRecordingDuration(durationMs);
    const client = await this.adb.selected();
    const id = randomUUID();
    const remotePath = `/sdcard/rn-observer-${id}.mp4`;
    // Pass the whole pipeline as ONE shell argument: adb's client joins
    // multiple arguments with spaces without quoting, which would strip the
    // command down to `sh -c setsid`. setsid detaches screenrecord from the
    // adb session so adbd does not kill it when the connection closes.
    const command =
      `setsid screenrecord --time-limit ${Math.ceil(clamped / 1000)} ${remotePath} ` +
      '</dev/null >/dev/null 2>&1 & echo $!';
    const pidOutput = await client.text(['shell', command]);
    const pid = pidOutput.trim().split(/\s+/).at(-1) ?? '';
    if (!/^\d+$/.test(pid)) {
      throw new ObserverError(
        'RECORDING_START_FAILED',
        'screenrecord did not report a process id on the device',
        true,
        'Check that the screen is unlocked and screenrecord is available',
      );
    }
    const recording: ActiveRecording = {
      id,
      source: 'android-screenrecord',
      startedAt: new Date().toISOString(),
      pid,
      remotePath,
      ...(sessionId ? { sessionId } : {}),
    };
    writeFileSync(this.statePath(id), JSON.stringify(recording));
    return recording;
  }

  async stop(recordingId: string): Promise<CompletedRecording> {
    const statePath = this.statePath(recordingId);
    let recording: ActiveRecording | undefined;
    try {
      recording = JSON.parse(
        readFileSync(statePath, 'utf8'),
      ) as ActiveRecording;
    } catch {
      recording = undefined;
    }
    if (!recording) {
      throw new ObserverError(
        'RECORDING_NOT_ACTIVE',
        `Recording ${recordingId} is not active`,
        true,
      );
    }
    const client = await this.adb.selected();
    await client.shell(['kill', '-2', recording.pid]).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const artifact = this.artifacts.write('recording', Buffer.alloc(0), {
      ...(recording.sessionId ? { sessionId: recording.sessionId } : {}),
      extension: '.mp4',
      mimeType: 'video/mp4',
    });
    await client.text(['pull', recording.remotePath, artifact.path], 60_000);
    await client
      .shell(['rm', '-f', recording.remotePath])
      .catch(() => undefined);
    if (existsSync(statePath)) unlinkSync(statePath);
    return {
      trace: {
        id: recording.id,
        source: recording.source,
        startedAt: recording.startedAt,
        stoppedAt: new Date().toISOString(),
        artifactId: artifact.id,
      },
      artifact,
      ...(recording.sessionId ? { sessionId: recording.sessionId } : {}),
    };
  }
}
