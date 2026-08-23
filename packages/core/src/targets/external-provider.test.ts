import { describe, expect, it, vi } from 'vitest';
import { createExternalPluginDescriptor } from '../plugins/conformance.js';
import { EXTERNAL_PLUGIN_PROTOCOL } from '../plugins/manifest.js';
import {
  ExternalTargetProviderClient,
  ExternalTargetProviderRegistry,
  TARGET_PROVIDER_PROTOCOL,
  createTargetProviderRequest,
  parseTargetProviderResponse,
  targetProviderSupportMatrix,
  type TargetProviderRequest,
  type TargetProviderTransport,
} from './external-provider.js';

const providerDescriptor = (
  id = 'community.ios-provider',
  provides: readonly string[] = [
    'target.ios.screenshot',
    'target.ios.device-info',
  ],
) =>
  createExternalPluginDescriptor({
    manifestVersion: 1,
    apiVersion: 1,
    id,
    displayName: 'iOS provider',
    version: '1.2.3',
    kind: 'provider',
    capabilities: { provides, requires: ['host.evidence-v1'] },
    permissions: ['device:read'],
    risk: 'read-only',
    execution: {
      mode: 'external-process',
      protocol: EXTERNAL_PLUGIN_PROTOCOL,
      command: 'node',
      args: ['provider.mjs'],
      shell: false,
      environmentAllowlist: [],
      requestTimeoutMs: 1_000,
      shutdownTimeoutMs: 500,
      maxMessageBytes: 65_536,
    },
  });

const request = (): TargetProviderRequest =>
  createTargetProviderRequest({
    requestId: 'request-1',
    operation: 'screenshot',
    target: {
      platform: 'ios',
      deviceId: 'simulator-1',
      appId: 'dev.example',
    },
  });

const responseFor = (
  current: TargetProviderRequest,
  options: {
    providerId?: string;
    providerVersion?: string;
    payload?: unknown;
    status?: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
    limitations?: string[];
  } = {},
) => ({
  protocol: TARGET_PROVIDER_PROTOCOL,
  schemaVersion: '1.0',
  requestId: current.requestId,
  operation: current.operation,
  status: options.status ?? 'AVAILABLE',
  evidence:
    options.status === 'UNAVAILABLE'
      ? []
      : [
          {
            schemaVersion: '1.0',
            id: 'evidence-1',
            runId: 'run-1',
            kind: 'screenshot-metadata',
            capturedAt: '2026-08-22T00:00:00.000Z',
            provider: {
              id: options.providerId ?? 'community.ios-provider',
              version: options.providerVersion ?? '1.2.3',
            },
            target: {
              platform: 'ios',
              deviceId: 'simulator-1',
              appId: 'dev.example',
            },
            availability: { status: 'AVAILABLE' },
            classification: 'sensitive',
            references: [],
            payload: options.payload ?? { artifactId: 'artifact-1' },
          },
        ],
  limitations: options.limitations ?? [],
});

describe('external target provider contract', () => {
  it('collects only a declared capability and validates evidence identity', async () => {
    const descriptor = providerDescriptor();
    const collect = vi.fn(async (input: unknown) =>
      responseFor(input as TargetProviderRequest),
    );
    const client = new ExternalTargetProviderClient({
      descriptor,
      collect,
    });

    const result = await client.collect({
      requestId: 'request-1',
      operation: 'screenshot',
      target: {
        platform: 'ios',
        deviceId: 'simulator-1',
        appId: 'dev.example',
      },
    });

    expect(result.status).toBe('AVAILABLE');
    expect(result.evidence).toHaveLength(1);
    expect(collect).toHaveBeenCalledOnce();
    await expect(
      client.collect({
        operation: 'logs',
        target: { platform: 'ios' },
      }),
    ).rejects.toThrow('does not provide target.ios.logs');
  });

  it('rejects mismatched provider identity and inline binary payloads', () => {
    const descriptor = providerDescriptor();
    const current = request();

    expect(() =>
      parseTargetProviderResponse(
        responseFor(current, { providerId: 'malicious.provider' }),
        current,
        descriptor,
      ),
    ).toThrow('identity');
    expect(() =>
      parseTargetProviderResponse(
        responseFor(current, {
          payload: { image: 'data:image/png;base64,AAAA' },
        }),
        current,
        descriptor,
      ),
    ).toThrow('inline base64');
  });

  it('requires truthful unavailable responses and bounded requests', () => {
    const descriptor = providerDescriptor();
    const current = request();

    expect(() =>
      parseTargetProviderResponse(
        responseFor(current, { status: 'UNAVAILABLE' }),
        current,
        descriptor,
      ),
    ).toThrow('requires a non-empty limitation');
    expect(() =>
      createTargetProviderRequest({
        operation: 'logs',
        target: { platform: 'web' },
        parameters: { blob: 'inline-binary-is-not-allowed' },
      }),
    ).toThrow('not allowed');
    expect(() =>
      createTargetProviderRequest({
        operation: 'logs',
        target: { platform: 'web' },
        parameters: { filter: 'x'.repeat(70_000) },
      }),
    ).toThrow('host contract limit');
  });

  it('forces explicit selection when multiple providers claim one operation', () => {
    const createClient = (id: string): ExternalTargetProviderClient =>
      new ExternalTargetProviderClient({
        descriptor: providerDescriptor(id, ['target.web.logs']),
        collect: vi.fn(),
      } satisfies TargetProviderTransport);
    const registry = new ExternalTargetProviderRegistry();
    registry.register(createClient('community.web-a'));
    registry.register(createClient('community.web-b'));

    expect(() => registry.resolve('web', 'logs')).toThrow(
      'select providerId explicitly',
    );
    expect(
      registry.resolve('web', 'logs', 'community.web-b').descriptor.manifest.id,
    ).toBe('community.web-b');
  });

  it('advertises Android as built-in and other platforms only when configured', () => {
    const client = new ExternalTargetProviderClient({
      descriptor: providerDescriptor(),
      collect: vi.fn(),
    });
    const matrix = targetProviderSupportMatrix([client]);

    expect(
      matrix.platforms.find((item) => item.platform === 'android'),
    ).toMatchObject({ status: 'built-in' });
    expect(
      matrix.platforms.find((item) => item.platform === 'ios'),
    ).toMatchObject({
      status: 'extension-available',
      operations: { screenshot: ['community.ios-provider'] },
    });
    expect(
      matrix.platforms.find((item) => item.platform === 'web'),
    ).toMatchObject({ status: 'not-configured' });
  });
});
