import { describe, expect, it } from 'vitest';
import {
  consoleEntryFromEvent,
  exceptionFromEvent,
  heapFromUsage,
} from './devtools-exporter.js';
import { selectTarget, type MetroTarget } from './metro.js';

describe('devtools export helpers', () => {
  it('maps CDP console types to observer levels', () => {
    const entry = consoleEntryFromEvent(
      {
        type: 'error',
        args: [
          { value: 'RN Agent Observer demo console error' },
          { unserializableValue: '42' },
        ],
      },
      '2026-08-21T00:00:00.000Z',
    );
    expect(entry).toMatchObject({
      level: 'error',
      text: 'RN Agent Observer demo console error 42',
      source: 'cdp-Runtime.consoleAPICalled',
    });
    expect(
      consoleEntryFromEvent(
        { type: 'warning', args: [{ value: 'careful' }] },
        't',
      )?.level,
    ).toBe('warn');
    expect(
      consoleEntryFromEvent({ type: 'unknown-type', args: [] }, 't'),
    ).toBeNull();
  });

  it('keeps only the message line of an exception', () => {
    const entry = exceptionFromEvent(
      {
        exceptionDetails: {
          text: 'Uncaught',
          exception: {
            description:
              'Error: Demo unhandled exception\n    at foo (app.js:1)\n    at bar (app.js:2)',
          },
        },
      },
      '2026-08-21T00:00:00.000Z',
    );
    expect(entry?.text).toBe('Error: Demo unhandled exception');
  });

  it('reports heap usage honestly when unavailable', () => {
    expect(heapFromUsage({ usedSize: 1048576, totalSize: 4194304 })).toEqual({
      usedMb: 1,
      totalMb: 4,
      available: true,
      source: 'cdp-Runtime.getHeapUsage',
    });
    const unavailable = heapFromUsage(undefined);
    expect(unavailable.available).toBe(false);
    expect(unavailable.reason).toBeDefined();
    expect(unavailable.usedMb).toBeNull();
  });

  it('prefers the target matching the app ID and fails explicitly otherwise', () => {
    const targets: MetroTarget[] = [
      {
        id: 'other-1',
        title: 'com.other.app (Device)',
        webSocketDebuggerUrl:
          'ws://127.0.0.1:8081/inspector/debug?device=a&page=1',
      },
      {
        id: 'demo-1',
        title: 'dev.rnagentobserver.demo (Device)',
        appId: 'dev.rnagentobserver.demo',
        webSocketDebuggerUrl:
          'ws://127.0.0.1:8081/inspector/debug?device=b&page=1',
      },
    ];
    expect(selectTarget(targets, 'dev.rnagentobserver.demo').id).toBe('demo-1');
    try {
      selectTarget([], 'dev.rnagentobserver.demo');
      expect.unreachable('selectTarget should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(
        'DEVTOOLS_TARGET_NOT_FOUND',
      );
    }
  });
});
