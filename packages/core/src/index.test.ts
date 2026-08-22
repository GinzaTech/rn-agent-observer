import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ObserverCore, ObserverError } from './index.js';

describe('ObserverCore', () => {
  it('reports a normalized project root', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-status-'));
    try {
      const status = new ObserverCore({ projectRoot: root }).getStatus();
      expect(status.projectRoot).toBe(resolve(root));
      expect(status.plannedCommands).toEqual([]);
      expect(existsSync(join(root, '.artifacts'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('serializes errors without a stack trace', () => {
    const error = new ObserverError('NOT_IMPLEMENTED', 'Not available', false);
    expect(JSON.stringify(error.toJSON())).not.toContain('stack');
  });
});
