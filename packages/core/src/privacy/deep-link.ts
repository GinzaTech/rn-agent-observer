/**
 * Parts of a deep-link URI deliberately omitted from persisted or returned
 * evidence. The retained `uri` is safe to use only as a route-level replay
 * target: omitted components are never reconstructed.
 */
export type DeepLinkRedactedComponent =
  'credentials' | 'query' | 'fragment' | 'invalid-uri';

/** A stable placeholder for an input that cannot be parsed safely as a URI. */
export const REDACTED_DEEP_LINK_URI = '[REDACTED_DEEP_LINK]' as const;

/**
 * A persistence-safe deep-link representation. `uri` contains no URL
 * username/password, query, or fragment. `redactedComponents` records only
 * which parts were omitted, never their names or values.
 */
export interface RedactedDeepLinkUri {
  readonly uri: string;
  readonly redactedComponents: readonly DeepLinkRedactedComponent[];
}

/**
 * The only deep-link event payload accepted by the session boundary. Unknown
 * fields are intentionally discarded so a caller cannot attach a second raw
 * copy of the URI to a `deep_link` event.
 */
export interface PersistedDeepLinkEventData extends RedactedDeepLinkUri {
  readonly appId?: string;
}

const REDACTED_COMPONENTS = new Set<string>([
  'credentials',
  'query',
  'fragment',
  'invalid-uri',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const distinctComponents = (
  values: readonly DeepLinkRedactedComponent[],
): DeepLinkRedactedComponent[] => [...new Set(values)];

const suppliedComponents = (value: unknown): DeepLinkRedactedComponent[] =>
  Array.isArray(value)
    ? value.filter(
        (component): component is DeepLinkRedactedComponent =>
          typeof component === 'string' && REDACTED_COMPONENTS.has(component),
      )
    : [];

/**
 * Returns the URI's route-level representation without values that commonly
 * carry credentials. Inputs that cannot be parsed are represented by a fixed
 * placeholder instead of attempting lossy string surgery on sensitive text.
 */
export function redactDeepLinkUri(value: string): RedactedDeepLinkUri {
  try {
    const url = new URL(value);
    const redactedComponents: DeepLinkRedactedComponent[] = [];
    if (url.username || url.password) redactedComponents.push('credentials');
    if (url.search) redactedComponents.push('query');
    if (url.hash) redactedComponents.push('fragment');
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return {
      uri: url.toString(),
      redactedComponents,
    };
  } catch {
    return {
      uri: REDACTED_DEEP_LINK_URI,
      redactedComponents: ['invalid-uri'],
    };
  }
}

/**
 * Normalizes a session deep-link event before it reaches SQLite. Any supplied
 * redaction markers are retained only when they are known labels; the URI is
 * always sanitized again at this boundary.
 */
export function redactDeepLinkEventData(
  data: unknown,
): PersistedDeepLinkEventData {
  const record = isRecord(data) ? data : undefined;
  const redacted = redactDeepLinkUri(
    typeof record?.uri === 'string' ? record.uri : '',
  );
  return {
    ...(typeof record?.appId === 'string' ? { appId: record.appId } : {}),
    uri: redacted.uri,
    redactedComponents: distinctComponents([
      ...redacted.redactedComponents,
      ...suppliedComponents(record?.redactedComponents),
    ]),
  };
}

export const isDeepLinkSessionEventType = (type: string): boolean =>
  type === 'deep_link' || type === 'deep-link';
