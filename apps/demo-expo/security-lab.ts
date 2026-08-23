/**
 * Development-fixture parsing for the bounded active-security deep-link lab.
 * This module deliberately exposes no caller-provided URL/value in its result.
 */
export const SECURITY_LAB_SCHEME = 'rnobs-security-demo';
export const SECURITY_LAB_BASE_URI = `${SECURITY_LAB_SCHEME}://security/lab?item=fixture`;

const MAX_SECURITY_LAB_URI_CHARACTERS = 512;

export type SecurityLabDeepLinkStatus = 'idle' | 'accepted' | 'rejected';
export type SecurityLabDeepLinkReason =
  | 'awaiting-link'
  | 'canonical-fixture'
  | 'input-too-large'
  | 'invalid-url'
  | 'unexpected-target'
  | 'unexpected-query';

export interface SecurityLabDeepLinkResult {
  /** Whether this is an attempt to open the demo-owned custom scheme. */
  handled: boolean;
  status: SecurityLabDeepLinkStatus;
  /** A fixed diagnostic code only; it never contains a URI or query value. */
  reason: SecurityLabDeepLinkReason;
}

const IDLE_DEEP_LINK_RESULT: SecurityLabDeepLinkResult = {
  handled: false,
  status: 'idle',
  reason: 'awaiting-link',
};

function isSecurityLabScheme(value: string): boolean {
  return value.toLowerCase().startsWith(`${SECURITY_LAB_SCHEME}:`);
}

function rejected(
  reason: Exclude<
    SecurityLabDeepLinkReason,
    'awaiting-link' | 'canonical-fixture'
  >,
): SecurityLabDeepLinkResult {
  return { handled: true, status: 'rejected', reason };
}

/**
 * Accept exactly one benign fixture URI. Query mutations deliberately stay on
 * the SecurityLab screen with a fixed rejected state, which lets the active
 * scenario inspect a safe content state without ever rendering the input.
 */
export function inspectSecurityLabDeepLink(
  value: string | null | undefined,
): SecurityLabDeepLinkResult {
  if (!value || !isSecurityLabScheme(value)) return IDLE_DEEP_LINK_RESULT;
  if (value.length > MAX_SECURITY_LAB_URI_CHARACTERS) {
    return rejected('input-too-large');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return rejected('invalid-url');
  }

  if (
    url.protocol !== `${SECURITY_LAB_SCHEME}:` ||
    url.hostname !== 'security' ||
    url.pathname !== '/lab' ||
    url.port.length > 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    return rejected('unexpected-target');
  }

  // Exact matching intentionally rejects duplicated, encoded, empty, large,
  // or unexpected query values used by the bounded malformed-query scenario.
  if (url.search !== '?item=fixture') return rejected('unexpected-query');

  return { handled: true, status: 'accepted', reason: 'canonical-fixture' };
}
