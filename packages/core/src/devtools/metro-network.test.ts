import { describe, expect, it } from 'vitest';
import { mergeCdpNetworkEvents } from './metro-network.js';
import { redactUrl } from '../network/network.js';
import { summarizeProfile } from './profiler.js';
import {
  clampRecordingDuration,
  MAX_RECORDING_DURATION_MS,
} from '../recording/screen-recorder.js';

describe('metro CDP network', () => {
  it('merges request/response/finished events into requests', () => {
    const requests = mergeCdpNetworkEvents(
      [
        {
          method: 'Network.requestWillBeSent',
          params: {
            requestId: 'r1',
            request: { url: 'http://localhost:8081/status', method: 'GET' },
            timestamp: 10,
            wallTime: 1787288000,
          },
        },
        {
          method: 'Network.responseReceived',
          params: {
            requestId: 'r1',
            response: { status: 200 },
            timestamp: 10.25,
          },
        },
        {
          method: 'Network.loadingFinished',
          params: {
            requestId: 'r1',
            timestamp: 10.4,
            encodedDataLength: 42,
          },
        },
        {
          method: 'Network.requestWillBeSent',
          params: {
            requestId: 'r2',
            request: {
              url: 'https://api.test/x?access_token=secret',
              method: 'POST',
            },
            timestamp: 11,
          },
        },
        {
          method: 'Network.loadingFailed',
          params: { requestId: 'r2', timestamp: 11.5, errorText: 'net::ERR' },
        },
      ],
      '2026-08-21T00:00:00.000Z',
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      id: 'r1',
      method: 'GET',
      url: 'http://localhost:8081/status',
      status: 200,
      durationMs: 400,
      responseBytes: 42,
      source: 'metro-cdp-network',
    });
    expect(requests[0]?.timestamp).toBe(
      new Date(1787288000 * 1_000).toISOString(),
    );
    expect(requests[1]).toMatchObject({
      id: 'r2',
      durationMs: 500,
      error: 'net::ERR',
    });
    expect(requests[1]?.status).toBeUndefined();
    expect(requests[1]?.url).not.toContain('secret');
    expect(requests[1]?.url).toMatch(/REDACTED/i);
  });

  it('keeps the first timestamp on redirects with the latest url', () => {
    const requests = mergeCdpNetworkEvents(
      [
        {
          method: 'Network.requestWillBeSent',
          params: {
            requestId: 'r3',
            request: { url: 'http://a.test/1', method: 'GET' },
            timestamp: 20,
          },
        },
        {
          method: 'Network.requestWillBeSent',
          params: {
            requestId: 'r3',
            request: { url: 'http://a.test/2', method: 'GET' },
            timestamp: 20.3,
          },
        },
        {
          method: 'Network.responseReceived',
          params: {
            requestId: 'r3',
            response: { status: 200 },
            timestamp: 20.5,
          },
        },
      ],
      '2026-08-21T00:00:00.000Z',
    );
    expect(requests[0]).toMatchObject({
      url: 'http://a.test/2',
      durationMs: 500,
    });
  });

  it('redacts sensitive query params host-side', () => {
    const redacted = redactUrl(
      'https://example.test/items?access_token=x&sid=abc&unknown=ghi&q=safe',
    );
    expect(redacted).not.toContain('x&');
    expect(redacted).not.toContain('abc');
    expect(redacted).not.toContain('ghi');
    expect(redacted).toContain('q=safe');
    expect(redactUrl('not a url token=abc')).toBe('not a url token=[REDACTED]');
  });
});

describe('devtools profiler', () => {
  it('summarizes node and sample counts', () => {
    const result = summarizeProfile({
      nodes: [{ id: 1 }, { id: 2 }],
      samples: [1, 1, 2],
    });
    expect(result.nodeCount).toBe(2);
    expect(result.sampleCount).toBe(3);
    const empty = summarizeProfile(undefined);
    expect(empty.nodeCount).toBe(0);
    expect(empty.sampleCount).toBe(0);
  });
});

describe('screen recorder', () => {
  it('clamps duration to the Android screenrecord limit', () => {
    expect(clampRecordingDuration(500)).toBe(1_000);
    expect(clampRecordingDuration(10_000)).toBe(10_000);
    expect(clampRecordingDuration(999_999)).toBe(MAX_RECORDING_DURATION_MS);
  });
});
