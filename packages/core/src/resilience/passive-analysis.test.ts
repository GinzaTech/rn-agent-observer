import { describe, expect, it } from 'vitest';
import {
  AssuranceFindingSchema,
  type AppState,
  type LogEntry,
  type NetworkRequest,
} from '@rn-agent-observer/schemas';
import {
  analyzePassiveResilience,
  type PassiveResilienceInput,
  type ResilienceCheckpoint,
  type ResilienceExpectation,
} from './passive-analysis.js';

const BEFORE = '2026-08-22T00:00:00.000Z';
const FAULT = '2026-08-22T00:00:01.000Z';
const RECOVERY = '2026-08-22T00:00:03.000Z';

function appState(overrides: Partial<AppState> = {}): AppState {
  return {
    appId: 'dev.test',
    processRunning: true,
    pid: 42,
    foregroundActivity: 'dev.test/.SensitiveInternalActivity',
    appInForeground: true,
    source: 'adb-pidof+dumpsys-activity',
    timestamp: RECOVERY,
    ...overrides,
  };
}

function request(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'request-recovery',
    method: 'GET',
    url: 'https://private.example.test/account/123',
    status: 200,
    durationMs: 100,
    timestamp: RECOVERY,
    source: 'rn-instrumentation',
    ...overrides,
  };
}

function checkpoint(
  capturedAt: string,
  overrides: Partial<ResilienceCheckpoint> = {},
): ResilienceCheckpoint {
  return {
    capturedAt,
    appState: appState({ timestamp: capturedAt }),
    screen: { state: 'content', timestamp: capturedAt, issueCodes: [] },
    network: [request({ timestamp: capturedAt })],
    logs: [],
    ...overrides,
  };
}

function baseInput(
  expectations: ResilienceExpectation[],
  overrides: Partial<PassiveResilienceInput> = {},
): PassiveResilienceInput {
  return {
    scenarioId: 'offline-recovery',
    scenarioKind: 'caller-declared-offline',
    checkpoints: {
      before: checkpoint(BEFORE),
      fault: checkpoint(FAULT),
      recovery: checkpoint(RECOVERY),
    },
    expectations,
    analyzedAt: RECOVERY,
    ...overrides,
  };
}

describe('passive resilience pack', () => {
  it('passes explicit expectations without exposing route-like or request data', () => {
    const result = analyzePassiveResilience(
      baseInput([
        {
          id: 'process',
          title: 'Process recovered',
          type: 'process-running',
          phase: 'recovery',
          expected: true,
        },
        {
          id: 'foreground',
          title: 'App returned to foreground',
          type: 'foreground',
          phase: 'recovery',
          expected: true,
        },
        {
          id: 'screen',
          title: 'Screen recovered',
          type: 'screen-state',
          phase: 'recovery',
          allowed: ['content', 'empty'],
        },
        {
          id: 'loading',
          title: 'Loading completed',
          type: 'no-stuck-loading',
          phase: 'recovery',
        },
        {
          id: 'logs',
          title: 'No runtime errors',
          type: 'no-runtime-errors',
          phase: 'recovery',
        },
        {
          id: 'network',
          title: 'A recovery request succeeded',
          type: 'network-result',
          phase: 'recovery',
          expected: 'success',
          mode: 'any',
          minimumSamples: 1,
          requestIds: ['request-recovery'],
        },
        {
          id: 'deadline',
          title: 'Recovery met the deadline',
          type: 'recovery-within',
          fromPhase: 'fault',
          toPhase: 'recovery',
          maxDurationMs: 5_000,
        },
      ]),
    );

    expect(result.outcome).toBe('PASS');
    expect(result.findings).toHaveLength(7);
    expect(result.findings.every((finding) => finding.outcome === 'PASS')).toBe(
      true,
    );
    expect(
      result.findings.every(
        (finding) => AssuranceFindingSchema.safeParse(finding).success,
      ),
    ).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('SensitiveInternalActivity');
    expect(serialized).not.toContain('private.example.test');
  });

  it('preserves ReactHost soft exceptions without failing runtime recovery', () => {
    const result = analyzePassiveResilience(
      baseInput(
        [
          {
            id: 'logs',
            title: 'No actionable runtime errors',
            type: 'no-runtime-errors',
            phase: 'recovery',
          },
        ],
        {
          checkpoints: {
            recovery: checkpoint(RECOVERY, {
              logs: [
                {
                  level: 'error',
                  source: 'unknown',
                  timestamp: RECOVERY,
                  message:
                    'ReactHost: ReactNoCrashSoftException: onWindowFocusChange before context ready',
                },
                {
                  level: 'error',
                  source: 'unknown',
                  timestamp: RECOVERY,
                  message:
                    'ReactHost: \tat com.facebook.react.runtime.ReactHostImpl.focus(Host.kt:1)',
                },
              ],
            }),
          },
        },
      ),
    );

    expect(result.outcome).toBe('PASS');
    expect(result.findings[0]?.outcome).toBe('PASS');
  });

  it('fails explicit crash, stuck-loading, error, network, and deadline evidence', () => {
    const secretLog: LogEntry = {
      level: 'error',
      source: 'ReactNativeJS',
      timestamp: RECOVERY,
      message: 'private-token-must-not-be-repeated',
    };
    const result = analyzePassiveResilience(
      baseInput(
        [
          {
            id: 'process',
            title: 'Process survived',
            type: 'process-running',
            phase: 'fault',
            expected: true,
          },
          {
            id: 'screen',
            title: 'Screen recovered',
            type: 'screen-state',
            phase: 'recovery',
            allowed: ['content'],
          },
          {
            id: 'loading',
            title: 'Loading did not stick',
            type: 'no-stuck-loading',
            phase: 'recovery',
          },
          {
            id: 'logs',
            title: 'No runtime errors',
            type: 'no-runtime-errors',
            phase: 'recovery',
          },
          {
            id: 'network',
            title: 'Recovery requests succeeded',
            type: 'network-result',
            phase: 'recovery',
            expected: 'success',
            mode: 'all',
            minimumSamples: 1,
          },
          {
            id: 'deadline',
            title: 'Recovery met the deadline',
            type: 'recovery-within',
            fromPhase: 'fault',
            toPhase: 'recovery',
            maxDurationMs: 1_000,
          },
        ],
        {
          checkpoints: {
            fault: checkpoint(FAULT, {
              appState: appState({
                processRunning: false,
                pid: null,
                appInForeground: false,
                timestamp: FAULT,
              }),
            }),
            recovery: checkpoint('2026-08-22T00:00:10.000Z', {
              screen: {
                state: 'loading',
                timestamp: '2026-08-22T00:00:10.000Z',
                issueCodes: ['loading-stuck'],
              },
              logs: [secretLog],
              network: [
                request({
                  status: 503,
                  url: 'https://private.example.test/failure',
                }),
              ],
            }),
          },
        },
      ),
    );

    expect(result.outcome).toBe('FAIL');
    expect(result.findings.every((finding) => finding.outcome === 'FAIL')).toBe(
      true,
    );
    expect(
      result.findings.every(
        (finding) => AssuranceFindingSchema.safeParse(finding).success,
      ),
    ).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private-token-must-not-be-repeated');
    expect(serialized).not.toContain('private.example.test');
  });

  it('returns NOT_VERIFIED for missing, incomplete, or still-loading evidence', () => {
    const result = analyzePassiveResilience(
      baseInput(
        [
          {
            id: 'process',
            title: 'Process recovered',
            type: 'process-running',
            phase: 'recovery',
            expected: true,
          },
          {
            id: 'loading',
            title: 'Loading completed',
            type: 'no-stuck-loading',
            phase: 'fault',
          },
          {
            id: 'network',
            title: 'Request completed',
            type: 'network-result',
            phase: 'fault',
            expected: 'failure',
            mode: 'any',
            minimumSamples: 1,
          },
        ],
        {
          checkpoints: {
            fault: checkpoint(FAULT, {
              screen: { state: 'loading', timestamp: FAULT },
              network: [request({ status: undefined, error: undefined })],
            }),
          },
        },
      ),
    );

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(
      result.findings.every(
        (finding) =>
          finding.outcome === 'NOT_VERIFIED' && finding.limitations.length > 0,
      ),
    ).toBe(true);
    expect(
      result.findings.every(
        (finding) => AssuranceFindingSchema.safeParse(finding).success,
      ),
    ).toBe(true);
  });

  it('downgrades otherwise passing degraded evidence', () => {
    const result = analyzePassiveResilience(
      baseInput(
        [
          {
            id: 'process',
            title: 'Process recovered',
            type: 'process-running',
            phase: 'recovery',
            expected: true,
          },
        ],
        {
          checkpoints: {
            recovery: checkpoint(RECOVERY, {
              availability: {
                status: 'DEGRADED',
                reason: 'partial app-state capture',
              },
            }),
          },
        },
      ),
    );

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.findings[0]).toMatchObject({
      outcome: 'NOT_VERIFIED',
      limitations: [expect.stringContaining('partial app-state capture')],
    });
  });

  it('requires explicit, valid, uniquely identified expectations', () => {
    const empty = analyzePassiveResilience(baseInput([]));
    expect(empty.outcome).toBe('NOT_VERIFIED');
    expect(empty.evaluations[0]?.type).toBe('expectations');

    const duplicate: ResilienceExpectation = {
      id: 'same',
      title: 'Process recovered',
      type: 'process-running',
      phase: 'recovery',
      expected: true,
    };
    expect(() =>
      analyzePassiveResilience(baseInput([duplicate, duplicate])),
    ).toThrow(/Duplicate/u);
    expect(() =>
      analyzePassiveResilience(
        baseInput([
          {
            id: 'bad-samples',
            title: 'Network result',
            type: 'network-result',
            phase: 'recovery',
            expected: 'success',
            mode: 'all',
            minimumSamples: 0,
          },
        ]),
      ),
    ).toThrow(/minimumSamples/u);
    expect(() =>
      analyzePassiveResilience(
        baseInput([
          {
            id: 'bad-timing',
            title: 'Recovery timing',
            type: 'recovery-within',
            fromPhase: 'recovery',
            toPhase: 'recovery',
            maxDurationMs: 1_000,
          },
        ]),
      ),
    ).toThrow(/different timing phases/u);
  });
});
