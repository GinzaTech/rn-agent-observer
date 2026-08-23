import { describe, expect, it } from 'vitest';
import {
  REDACTED_DEEP_LINK_URI,
  redactDeepLinkEventData,
  redactDeepLinkUri,
} from './deep-link.js';

describe('deep-link privacy', () => {
  it('keeps a route-level URI while removing credentials, query, and fragment', () => {
    const raw =
      'demo://alice:correct-horse@store.example/products/42?token=private-token&returnTo=private-route#private-fragment';

    const redacted = redactDeepLinkUri(raw);

    expect(redacted).toEqual({
      uri: 'demo://store.example/products/42',
      redactedComponents: ['credentials', 'query', 'fragment'],
    });
    expect(JSON.stringify(redacted)).not.toContain('alice');
    expect(JSON.stringify(redacted)).not.toContain('correct-horse');
    expect(JSON.stringify(redacted)).not.toContain('private-token');
    expect(JSON.stringify(redacted)).not.toContain('private-fragment');
  });

  it('uses a fixed placeholder rather than retaining malformed input', () => {
    const raw = 'not a uri?token=private-token#private-fragment';

    expect(redactDeepLinkUri(raw)).toEqual({
      uri: REDACTED_DEEP_LINK_URI,
      redactedComponents: ['invalid-uri'],
    });
  });

  it('accepts only the documented session payload fields', () => {
    const raw = 'demo://user:password@host/path?code=private#private';

    expect(
      redactDeepLinkEventData({
        appId: 'dev.example.app',
        uri: raw,
        rawCopy: raw,
        redactedComponents: ['query', 'not-a-real-component'],
      }),
    ).toEqual({
      appId: 'dev.example.app',
      uri: 'demo://host/path',
      redactedComponents: ['credentials', 'query', 'fragment'],
    });
  });
});
