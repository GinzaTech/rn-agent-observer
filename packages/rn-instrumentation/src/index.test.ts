import { describe, expect, it } from 'vitest';
import {
  createInstrumentationConfig,
  redactHeaders,
  redactSensitiveText,
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
      'https://example.test/items?access_token=secret&sid=abc&custom_session=xyz&q=safe',
    );
    expect(result).not.toContain('secret');
    expect(result).not.toContain('abc');
    expect(result).not.toContain('xyz');
    expect(result).toContain('q=safe');
  });

  it('redacts sensitive headers but keeps ordinary ones', () => {
    const redacted = redactHeaders({
      'content-type': 'application/json',
      Authorization: 'Bearer super-secret',
      'Set-Cookie': 'session=abc123',
      'X-API-Key': 'key-1',
      'X-Custom-Session': 'unknown-secret',
    });
    expect(redacted['content-type']).toBe('application/json');
    expect(redacted.Authorization).toBe('[REDACTED]');
    expect(redacted['Set-Cookie']).toBe('[REDACTED]');
    expect(redacted['X-API-Key']).toBe('[REDACTED]');
    expect(redacted['X-Custom-Session']).toBe('[REDACTED]');
  });

  it('fails closed for unknown body fields and unstructured text', () => {
    expect(
      redactSensitiveText(
        JSON.stringify({ status: 200, sid: 'abc', profile: { name: 'K' } }),
      ),
    ).toBe(
      JSON.stringify({
        status: 200,
        sid: '[REDACTED]',
        profile: '[REDACTED]',
      }),
    );
    expect(redactSensitiveText('jwt=abc.def.ghi')).toBe('[REDACTED]');
  });
});
