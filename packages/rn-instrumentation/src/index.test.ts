import { describe, expect, it, vi } from 'vitest';
import {
  createInstrumentationConfig,
  observeInteraction,
  redactHeaders,
  redactSensitiveText,
  redactUrl,
  reportUiElement,
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

  it('records UI ownership and interaction outcome without arguments', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    reportUiElement({
      elementId: 'save-profile',
      testId: 'save-profile',
      componentName: 'Button',
      label: 'Save',
      mounted: true,
      visible: true,
      enabled: true,
    });
    const handler = observeInteraction(
      { elementId: 'save-profile', testId: 'save-profile', label: 'Save' },
      (_secret: string) => {
        void _secret;
        return 'done';
      },
    );
    expect(handler('never-log-this')).toBe('done');
    const output = info.mock.calls.flat().join('\n');
    expect(output).toContain('RN_AGENT_OBSERVER_UI_ELEMENT');
    expect(output).toContain('RN_AGENT_OBSERVER_UI_INTERACTION');
    expect(output).toContain('"phase":"success"');
    expect(output).not.toContain('never-log-this');
    info.mockRestore();
  });

  it('records handler errors and preserves the throw', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const handler = observeInteraction(
      { elementId: 'broken', testId: 'broken' },
      () => {
        throw new Error('fixture failure');
      },
    );
    expect(() => handler()).toThrow('fixture failure');
    expect(info.mock.calls.flat().join('\n')).toContain('"phase":"error"');
    info.mockRestore();
  });
});
