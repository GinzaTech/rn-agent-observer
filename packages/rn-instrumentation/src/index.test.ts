import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRenderTracker,
  createInstrumentationConfig,
  installNetworkObserver,
  isDevelopmentInstrumentationEnabled,
  observeInteraction,
  redactHeaders,
  redactSensitiveText,
  redactUrl,
  reportAppData,
  reportJsTask,
  reportNetworkRequest,
  reportRoute,
  reportUiElement,
} from './index.js';

type DevelopmentGlobal = typeof globalThis & { __DEV__?: unknown };

let hadDevelopmentFlag = false;
let originalDevelopmentFlag: unknown;

beforeEach(() => {
  const runtime = globalThis as DevelopmentGlobal;
  hadDevelopmentFlag = Object.hasOwn(runtime, '__DEV__');
  originalDevelopmentFlag = runtime.__DEV__;
  runtime.__DEV__ = true;
});

afterEach(() => {
  const runtime = globalThis as DevelopmentGlobal;
  if (hadDevelopmentFlag) {
    runtime.__DEV__ = originalDevelopmentFlag;
  } else {
    delete runtime.__DEV__;
  }
});

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

  it('fails closed outside a development React Native bundle', () => {
    const runtime = globalThis as DevelopmentGlobal;
    runtime.__DEV__ = false;
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const originalFetch = globalThis.fetch;

    expect(isDevelopmentInstrumentationEnabled()).toBe(false);
    reportRoute('ProductionRoute');
    reportUiElement({
      elementId: 'production-button',
      componentName: 'Button',
      mounted: true,
    });
    expect(
      observeInteraction({ elementId: 'production-button' }, (value: string) =>
        value.toUpperCase(),
      )('safe'),
    ).toBe('SAFE');
    reportAppData('production', { route: 'ProductionRoute' });
    reportJsTask(4, 'production');
    reportNetworkRequest({
      method: 'GET',
      url: 'https://example.test/health',
      durationMs: 4,
    });
    createRenderTracker('Production')('production', 'mount', 1);
    const uninstall = installNetworkObserver();

    expect(globalThis.fetch).toBe(originalFetch);
    expect(info).not.toHaveBeenCalled();
    uninstall();
    info.mockRestore();
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

  it('writes a version marker on every telemetry channel', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    reportRoute('Home');
    reportUiElement({
      elementId: 'save',
      componentName: 'Button',
      mounted: true,
    });
    observeInteraction({ elementId: 'save' }, () => undefined)();
    reportAppData('screen', { route: 'Home' });
    reportJsTask(12, 'fixture');
    reportNetworkRequest({
      method: 'GET',
      url: 'https://example.test/health',
      status: 200,
      durationMs: 10,
    });
    createRenderTracker('Fixture')('fixture', 'mount', 1);

    expect(info.mock.calls).toHaveLength(8);
    for (const [line] of info.mock.calls) {
      expect(String(line)).toContain('"telemetryVersion":1');
    }
    info.mockRestore();
  });

  it('fails closed for unknown and sensitive app-data fields', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    reportAppData('render lab', {
      route: 'RenderLab',
      tick: 3,
      password: 'never-log-password',
      customState: 'never-log-custom-state',
      status: 'ready for owner@example.test',
    });

    const line = String(info.mock.calls[0]?.[0]);
    const payload = JSON.parse(line.slice(line.indexOf('{'))) as {
      namespace: string;
      data: Record<string, unknown>;
      privacy: { policy: string; redacted: boolean; truncated: boolean };
    };
    expect(payload).toMatchObject({
      namespace: 'render-lab',
      data: {
        route: 'RenderLab',
        tick: 3,
        password: '[REDACTED]',
        customState: '[REDACTED]',
        status: 'ready for [REDACTED_EMAIL]',
      },
      privacy: {
        policy: 'default-safe-allowlist',
        redacted: true,
        truncated: false,
      },
    });
    expect(line).not.toContain('never-log-password');
    expect(line).not.toContain('never-log-custom-state');
    expect(line).not.toContain('owner@example.test');
    info.mockRestore();
  });

  it('uses explicit safe keys without allowing sensitive key names', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    reportAppData(
      'flags',
      { featureName: 'checkout-v2', accessToken: 'never-log-token' },
      { safeKeys: ['featureName', 'accessToken'] },
    );

    const line = String(info.mock.calls[0]?.[0]);
    expect(line).toContain('"featureName":"checkout-v2"');
    expect(line).toContain('"accessToken":"[REDACTED]"');
    expect(line).toContain('"policy":"explicit-safe-allowlist"');
    expect(line).not.toContain('never-log-token');
    info.mockRestore();
  });

  it('caps oversized app-data with an honest redaction marker', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const data = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `safe${index}`,
        'x'.repeat(160),
      ]),
    );
    reportAppData('large', data, {
      safeKeys: Object.keys(data),
      maxPayloadCharacters: 512,
    });

    const line = String(info.mock.calls[0]?.[0]);
    const serializedPayload = line.slice(line.indexOf('{'));
    expect(serializedPayload.length).toBeLessThanOrEqual(512);
    expect(line).toContain('"data":"[REDACTED_PAYLOAD_TOO_LARGE]"');
    expect(line).toContain('"truncated":true');
    info.mockRestore();
  });
});
