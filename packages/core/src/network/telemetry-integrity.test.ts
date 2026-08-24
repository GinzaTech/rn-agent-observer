import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyTelemetrySignature } from './network.js';
import { detectTextLanguage } from '../ui/understanding.js';

describe('telemetry signature verification', () => {
  it('passes unsigned payloads through with signatureValid null', () => {
    const result = verifyTelemetrySignature('{"route":"Home"}');
    expect(result).toEqual({
      body: '{"route":"Home"}',
      signatureValid: null,
    });
  });

  it('accepts a correctly signed payload and strips the tag', () => {
    process.env.RN_OBSERVER_TELEMETRY_SECRET = 'dev-secret';
    try {
      const body = '{"route":"Home"}';
      const tag = createHmac('sha256', 'dev-secret').update(body).digest('hex');
      const result = verifyTelemetrySignature(`${body} rnobsSig=${tag}`);
      expect(result.body).toBe(body);
      expect(result.signatureValid).toBe(true);
    } finally {
      delete process.env.RN_OBSERVER_TELEMETRY_SECRET;
    }
  });

  it('rejects a forged signature when a secret is configured', () => {
    process.env.RN_OBSERVER_TELEMETRY_SECRET = 'dev-secret';
    try {
      const result = verifyTelemetrySignature(
        '{"route":"Evil"} rnobsSig=deadbeef',
      );
      expect(result.signatureValid).toBe(false);
    } finally {
      delete process.env.RN_OBSERVER_TELEMETRY_SECRET;
    }
  });

  it('rejects an unsigned payload when integrity mode is enabled', () => {
    process.env.RN_OBSERVER_TELEMETRY_SECRET = 'dev-secret';
    try {
      expect(verifyTelemetrySignature('{"route":"Home"}')).toMatchObject({
        signatureValid: false,
      });
    } finally {
      delete process.env.RN_OBSERVER_TELEMETRY_SECRET;
    }
  });
});

describe('text language detection', () => {
  it('does not misclassify Cyrillic as Vietnamese', () => {
    expect(detectTextLanguage(['Загрузка не удалась']).language).toBe(
      'unknown',
    );
  });
  it('separates Japanese (kana) from Chinese (hanzi only)', () => {
    expect(detectTextLanguage(['読み込み中']).language).toBe('ja');
    expect(detectTextLanguage(['暂无数据']).language).toBe('zh');
  });
});
