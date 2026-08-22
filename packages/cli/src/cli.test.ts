import { describe, expect, it } from 'vitest';
import { runCli } from './cli.js';

function capture(): {
  out: string[];
  err: string[];
  io: Parameters<typeof runCli>[1];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (value) => out.push(value),
      stderr: (value) => err.push(value),
    },
  };
}

describe('rn-observe CLI', () => {
  it('prints help', async () => {
    const result = capture();
    expect(await runCli(['--help'], result.io)).toBe(0);
    expect(result.out[0]).toContain('rn-observe 2.4.0');
    expect(result.out[0]).toContain('devtools-export');
    expect(result.out[0]).toContain('metro-network');
    expect(result.out[0]).toContain('record start');
    expect(result.out[0]).toContain('snapshot');
    expect(result.out[0]).toContain('understand-screen');
    expect(result.out[0]).toContain('replay run');
  });

  it('prints structured status', async () => {
    const result = capture();
    expect(await runCli(['status'], result.io)).toBe(0);
    expect(JSON.parse(result.out[0] ?? '{}')).toMatchObject({
      phase: 'android-v1',
    });
  });

  it('fails explicitly for unknown commands', async () => {
    const result = capture();
    expect(await runCli(['unknown'], result.io)).toBe(2);
    expect(result.err[0]).toContain('INTERNAL_ERROR');
  });
});
