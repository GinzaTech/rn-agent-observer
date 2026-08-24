import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hmacSha256Hex } from './hmac.js';

describe('development telemetry HMAC', () => {
  it('matches Node HMAC-SHA-256 for unicode payloads', () => {
    const secret = 'dev-secret-✓';
    const body = '{"route":"Trang chủ","value":"読み込み中"}';
    expect(hmacSha256Hex(secret, body)).toBe(
      createHmac('sha256', secret).update(body).digest('hex'),
    );
  });
});
