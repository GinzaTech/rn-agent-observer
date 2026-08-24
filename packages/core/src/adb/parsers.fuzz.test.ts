import { describe, expect, it } from 'vitest';
import {
  parseAdbDevices,
  parseBounds,
  parseFrameTimes,
  parseLogcat,
  parsePermissionChangeExitStatus,
  parseProcNetDev,
  parseResumedActivity,
  parseRuntimePermissions,
  parseTopCpuPercent,
  parseTotalPssMb,
} from './parsers.js';

const seededInputs = (count: number): string[] => {
  let state = 0x726e6f62;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };

  return Array.from({ length: count }, () => {
    const length = next() % 512;
    return Array.from({ length }, () =>
      String.fromCharCode(9 + (next() % 118)),
    ).join('');
  });
};

describe('ADB parser bounded fuzz regression', () => {
  it('fails closed without throwing for deterministic hostile text', () => {
    const extremeNumber = '9'.repeat(2_048);
    const corpus = [
      '',
      '\0\0\0',
      `999999999999999999999999999999.0 1 1 E tag: message`,
      `TOTAL ${extremeNumber}`,
      `[${extremeNumber},0][1,1]`,
      ...seededInputs(512),
    ];

    for (const input of corpus) {
      expect(() => parseAdbDevices(input)).not.toThrow();
      expect(() => parseBounds(input)).not.toThrow();
      expect(() => parseFrameTimes(input)).not.toThrow();
      expect(() => parseLogcat(input)).not.toThrow();
      expect(() => parseProcNetDev(input)).not.toThrow();
      expect(() => parseResumedActivity(input)).not.toThrow();
      expect(() => parseRuntimePermissions(input)).not.toThrow();
      expect(() => parseTopCpuPercent(input)).not.toThrow();
      expect(() => parseTotalPssMb(input)).not.toThrow();
      expect(() =>
        parsePermissionChangeExitStatus(input, 'dev.rnagentobserver.demo', 1),
      ).not.toThrow();
    }
  });
});
