import { describe, expect, it } from 'vitest';
import {
  SECURITY_LAB_BASE_URI,
  inspectSecurityLabDeepLink,
} from './security-lab';

describe('SecurityLab deep-link fixture', () => {
  it('accepts only the canonical benign fixture URI', () => {
    expect(inspectSecurityLabDeepLink(SECURITY_LAB_BASE_URI)).toEqual({
      handled: true,
      status: 'accepted',
      reason: 'canonical-fixture',
    });
  });

  it('ignores schemes not owned by the fixture', () => {
    expect(inspectSecurityLabDeepLink('https://example.test/lab')).toEqual({
      handled: false,
      status: 'idle',
      reason: 'awaiting-link',
    });
  });

  it.each([
    'rnobs-security-demo://security/lab?item=',
    'rnobs-security-demo://security/lab?item=fixture&item=fixture',
    'rnobs-security-demo://security/lab?item=%',
    'rnobs-security-demo://security/lab?unexpected=fixture',
  ])('rejects a malformed query without retaining its input', (input) => {
    const result = inspectSecurityLabDeepLink(input);
    expect(result).toMatchObject({ handled: true, status: 'rejected' });
    expect(JSON.stringify(result)).not.toContain(input);
  });

  it('rejects an oversized owned URI before parsing it', () => {
    const input = `rnobs-security-demo://security/lab?item=${'x'.repeat(600)}`;
    expect(inspectSecurityLabDeepLink(input)).toEqual({
      handled: true,
      status: 'rejected',
      reason: 'input-too-large',
    });
  });
});
