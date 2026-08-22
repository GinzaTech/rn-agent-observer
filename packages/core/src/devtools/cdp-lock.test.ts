import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CdpConnectionLock, withCdpLock } from './cdp-lock.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('CDP connection lock', () => {
  it('acquires and releases', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cdp-lock-'));
    temporaryDirectories.push(root);
    const lock = new CdpConnectionLock(root);
    await lock.acquire();
    expect(lock.isHeld).toBe(true);
    lock.release();
    expect(lock.isHeld).toBe(false);
  });

  it('queues a second command until the first releases', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cdp-lock-'));
    temporaryDirectories.push(root);
    const first = new CdpConnectionLock(root);
    await first.acquire();
    const second = new CdpConnectionLock(root);
    const queued = second.acquire({ timeoutMs: 1_000, pollIntervalMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(second.isHeld).toBe(true);
    first.release();
    await expect(queued).resolves.toBeUndefined();
    second.release();
  });

  it('returns a recoverable timeout instead of stealing a live lock', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cdp-lock-'));
    temporaryDirectories.push(root);
    const first = new CdpConnectionLock(root);
    await first.acquire();
    const second = new CdpConnectionLock(root);
    await expect(
      second.acquire({ timeoutMs: 20, pollIntervalMs: 10 }),
    ).rejects.toThrow(/Timed out/);
    expect(first.isHeld).toBe(true);
    first.release();
  });

  it('treats a lock from a dead pid as stale', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cdp-lock-'));
    temporaryDirectories.push(root);
    const directory = join(root, 'cdp-locks');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'inspector.lock'),
      JSON.stringify({
        pid: 999999999,
        holder: 'dead',
        acquiredAt: new Date().toISOString(),
      }),
    );
    const lock = new CdpConnectionLock(root);
    await expect(lock.acquire()).resolves.toBeUndefined();
    lock.release();
  });

  it('does not steal an old lock while its pid is alive', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cdp-lock-'));
    temporaryDirectories.push(root);
    const directory = join(root, 'cdp-locks');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'inspector.lock'),
      JSON.stringify({
        pid: process.pid,
        holder: 'old',
        acquiredAt: new Date(Date.now() - 120_000).toISOString(),
      }),
    );
    const lock = new CdpConnectionLock(root);
    await expect(
      lock.acquire({ timeoutMs: 20, pollIntervalMs: 10 }),
    ).rejects.toThrow(/Timed out/);
    unlinkSync(join(directory, 'inspector.lock'));
  });

  it('withCdpLock releases on error and on success', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cdp-lock-'));
    temporaryDirectories.push(root);
    await expect(
      withCdpLock(root, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const lock = new CdpConnectionLock(root);
    await expect(lock.acquire()).resolves.toBeUndefined();
    lock.release();
    const value = await withCdpLock(root, async () => 42);
    expect(value).toBe(42);
  });
});
