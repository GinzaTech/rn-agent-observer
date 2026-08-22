import { describe, expect, it } from 'vitest';
import {
  createInstrumentationConfig,
  redactHeaders,
  redactUrl,
} from './index.js';

describe('runtime instrumentation', () => {
  it('keeps network body capture disabled', () => {
    expect(createInstrumentationConfig(true)).toEqual({
      enabled: true,
      captureNetworkBodies: false,
      maxBodyPreviewCharacters: 4096,
    });
  });

  it('requires explicit opt-in for development body capture', () => {
    expect(createInstrumentationConfig(true, true).captureNetworkBodies).toBe(
      true,
    );
  });

  it('redacts sensitive query parameters', () => {
    const result = redactUrl(
      'https://example.test/items?access_token=secret&email=user@example.test&q=safe',
    );
    expect(result).not.toContain('secret');
    expect(result).not.toContain('user@example.test');
    expect(result).toContain('q=safe');
  });

  it('redacts sensitive headers but keeps ordinary ones', () => {
    const redacted = redactHeaders({
      'content-type': 'application/json',
      Authorization: 'Bearer super-secret',
      'Set-Cookie': 'session=abc123',
      'X-API-Key': 'key-1',
    });
    expect(redacted['content-type']).toBe('application/json');
    expect(redacted.Authorization).toBe('[REDACTED]');
    expect(redacted['Set-Cookie']).toBe('[REDACTED]');
    expect(redacted['X-API-Key']).toBe('[REDACTED]');
  });
});
