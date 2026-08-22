import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Cross-process advisory lock for the single inspector connection.
 * Metro's inspector proxy allows one WebSocket client per target; without
 * this lock, concurrent observer commands (metro-network, devtools-export,
 * devtools-profile, reload --fast) would steal the connection from each other.
 *
 * The lock is stale after `staleMs` (a crashed holder must not block forever).
 */
interface StaleLock {
  pid: number;
  holder: string;
  acquiredAt: string;
}

export interface CdpLockOptions {
  /** Maximum time to wait behind another observer command. */
  timeoutMs?: number;
  /** Poll interval while queued. */
  pollIntervalMs?: number;
}

export class CdpConnectionLock {
  private readonly lockPath: string;
  private readonly holder = randomUUID();
  private held = false;

  constructor(
    artifactRoot: string,
    private readonly staleMs = 60_000,
  ) {
    const directory = join(artifactRoot, 'cdp-locks');
    mkdirSync(directory, { recursive: true });
    this.lockPath = join(directory, 'inspector.lock');
  }

  private readLock(): StaleLock | null {
    try {
      return JSON.parse(readFileSync(this.lockPath, 'utf8')) as StaleLock;
    } catch {
      return null;
    }
  }

  private isStale(lock: StaleLock | null): boolean {
    if (!lock) {
      try {
        return Date.now() - statSync(this.lockPath).mtimeMs > this.staleMs;
      } catch {
        return true;
      }
    }
    const age = Date.now() - Date.parse(lock.acquiredAt);
    if (!Number.isFinite(age)) return true;
    try {
      // Signal 0 only checks liveness. A live holder may legitimately profile
      // longer than staleMs, so age alone must never steal its lock.
      process.kill(lock.pid, 0);
      return false;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'EPERM'
      ) {
        return false;
      }
      return true;
    }
  }

  private removeStaleLock(lock: StaleLock | null): void {
    const current = this.readLock();
    if (
      current?.pid !== lock?.pid ||
      current?.holder !== lock?.holder ||
      !this.isStale(current)
    ) {
      return;
    }
    try {
      unlinkSync(this.lockPath);
    } catch {
      // A competing waiter already removed or replaced it.
    }
  }

  private tryAcquire(): boolean {
    if (this.held) return true;
    let descriptor: number;
    try {
      // wx is an atomic create-if-absent operation across processes.
      descriptor = openSync(this.lockPath, 'wx');
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'EEXIST'
      ) {
        const existing = this.readLock();
        if (this.isStale(existing)) this.removeStaleLock(existing);
        return false;
      }
      throw error;
    }
    try {
      writeFileSync(
        descriptor,
        JSON.stringify({
          pid: process.pid,
          holder: this.holder,
          acquiredAt: new Date().toISOString(),
        } satisfies StaleLock),
      );
    } finally {
      closeSync(descriptor);
    }
    this.held = true;
    return true;
  }

  async acquire(options: CdpLockOptions = {}): Promise<void> {
    if (this.held) return;
    const timeoutMs = Math.max(0, options.timeoutMs ?? 180_000);
    const pollIntervalMs = Math.max(10, options.pollIntervalMs ?? 100);
    const deadline = Date.now() + timeoutMs;
    while (!this.tryAcquire()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        const existing = this.readLock();
        throw new CdpLockError(
          `Timed out after ${timeoutMs}ms waiting for the inspector connection held by pid ${existing?.pid ?? 'unknown'}`,
          'Retry after the other CDP command finishes, or close React Native DevTools',
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(pollIntervalMs, remaining)),
      );
    }
  }

  release(): void {
    if (!this.held) return;
    const current = this.readLock();
    if (current?.pid === process.pid && current.holder === this.holder) {
      try {
        unlinkSync(this.lockPath);
      } catch {
        // already gone — nothing to clean
      }
    }
    this.held = false;
  }

  get isHeld(): boolean {
    return this.held || existsSync(this.lockPath);
  }
}

export class CdpLockError extends Error {
  constructor(
    message: string,
    readonly suggestion: string,
  ) {
    super(message);
    this.name = 'CdpLockError';
  }
}

/**
 * Runs `action` while holding the inspector lock for the given artifact root.
 * Concurrent commands queue until the holder releases it. The lock is always
 * released, including on thrown errors.
 */
export async function withCdpLock<T>(
  artifactRoot: string,
  action: () => Promise<T>,
  options: CdpLockOptions = {},
): Promise<T> {
  const lock = new CdpConnectionLock(artifactRoot);
  await lock.acquire(options);
  try {
    return await action();
  } finally {
    lock.release();
  }
}
