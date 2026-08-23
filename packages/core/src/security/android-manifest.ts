import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import type {
  AssuranceFinding,
  AssuranceOutcome,
  EvidenceReference,
} from '@rn-agent-observer/schemas';
import { securityOutcome, type SecurityAnalysisResult } from './types.js';

export interface AndroidManifestAnalysisOptions {
  sourcePath?: string;
  sourceKind?: 'source' | 'merged';
  buildType?: 'debug' | 'release' | 'unknown';
  analyzedAt?: string;
}

export interface NetworkSecurityConfigAnalysisOptions {
  sourcePath?: string;
  buildType?: 'debug' | 'release' | 'unknown';
  targetSdk?: number;
  analyzedAt?: string;
}

const DANGEROUS_PERMISSION_REVIEW = new Map<string, string>([
  ['android.permission.ACCESS_BACKGROUND_LOCATION', 'background location'],
  ['android.permission.CAMERA', 'camera'],
  ['android.permission.MANAGE_EXTERNAL_STORAGE', 'all-files storage access'],
  ['android.permission.QUERY_ALL_PACKAGES', 'installed application inventory'],
  ['android.permission.READ_CALL_LOG', 'call history'],
  ['android.permission.READ_CONTACTS', 'contacts'],
  ['android.permission.READ_MEDIA_IMAGES', 'user images'],
  ['android.permission.READ_MEDIA_VIDEO', 'user videos'],
  ['android.permission.READ_SMS', 'SMS messages'],
  ['android.permission.RECORD_AUDIO', 'microphone'],
  ['android.permission.REQUEST_INSTALL_PACKAGES', 'package installation'],
  ['android.permission.SEND_SMS', 'SMS sending'],
  ['android.permission.SYSTEM_ALERT_WINDOW', 'screen overlays'],
  ['android.permission.WRITE_CALL_LOG', 'call history modification'],
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const records = (value: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) {
    return value
      .map(recordValue)
      .filter((item): item is Record<string, unknown> => item !== undefined);
  }
  const item = recordValue(value);
  return item ? [item] : [];
};

const attribute = (
  value: Record<string, unknown>,
  name: string,
): string | undefined => {
  const candidate = value[`@_android:${name}`] ?? value[`@_${name}`];
  return typeof candidate === 'string' ? candidate : undefined;
};

const booleanAttribute = (
  value: Record<string, unknown>,
  name: string,
): boolean | undefined => {
  const candidate = attribute(value, name)?.toLowerCase();
  if (candidate === 'true') return true;
  if (candidate === 'false') return false;
  return undefined;
};

const evidenceFor = (
  source: string,
  sourcePath?: string,
): EvidenceReference => {
  const sha256 = createHash('sha256').update(source).digest('hex');
  return {
    id: `android-xml-${sha256.slice(0, 16)}`,
    kind: 'android-security-config',
    relation: 'supports',
    ...(sourcePath ? { uri: sourcePath } : {}),
    sha256,
  };
};

const finding = (input: {
  id: string;
  ruleId: string;
  title: string;
  description: string;
  outcome: AssuranceOutcome;
  severity: AssuranceFinding['severity'];
  confidence: number;
  controls: string[];
  evidence: EvidenceReference;
  sourcePath?: string;
  remediation?: string;
  limitation?: string;
}): AssuranceFinding => ({
  schemaVersion: '1.0',
  id: input.id,
  ruleId: input.ruleId,
  title: input.title,
  description: input.description,
  outcome: input.outcome,
  severity: input.severity,
  confidence: input.confidence,
  category: 'security',
  controls: input.controls,
  evidence: [input.evidence],
  ...(input.sourcePath ? { source: { file: input.sourcePath } } : {}),
  ...(input.remediation ? { remediation: input.remediation } : {}),
  limitations: input.limitation ? [input.limitation] : [],
});

const parseXml = (source: string): Record<string, unknown> => {
  const parsed = parser.parse(source) as unknown;
  const document = recordValue(parsed);
  if (!document) throw new TypeError('XML document did not contain an object');
  return document;
};

const parseFailure = (
  analyzer: string,
  evidence: EvidenceReference,
  options: { analyzedAt?: string; sourcePath?: string },
  error: unknown,
): SecurityAnalysisResult => {
  const limitation = `XML could not be parsed: ${error instanceof Error ? error.message : String(error)}`;
  const findings = [
    finding({
      id: `${analyzer}.parse`,
      ruleId: `${analyzer}.parse`,
      title: 'Security configuration could not be verified',
      description: 'Static security analysis requires well-formed XML.',
      outcome: 'NOT_VERIFIED',
      severity: 'high',
      confidence: 1,
      controls: ['MASVS-CODE-1'],
      evidence,
      ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
      limitation,
    }),
  ];
  return {
    schemaVersion: '1.0',
    analyzer,
    analyzedAt: options.analyzedAt ?? new Date().toISOString(),
    outcome: 'NOT_VERIFIED',
    evidence: [evidence],
    findings,
    limitations: [limitation],
  };
};

const hasIntentFilter = (component: Record<string, unknown>): boolean =>
  records(component['intent-filter']).length > 0;

const isPublicActivity = (component: Record<string, unknown>): boolean => {
  for (const filter of records(component['intent-filter'])) {
    const actions = records(filter.action).map((item) =>
      attribute(item, 'name'),
    );
    const categories = records(filter.category).map((item) =>
      attribute(item, 'name'),
    );
    if (
      actions.includes('android.intent.action.MAIN') ||
      categories.includes('android.intent.category.BROWSABLE')
    ) {
      return true;
    }
  }
  return false;
};

export const analyzeAndroidManifest = (
  source: string,
  options: AndroidManifestAnalysisOptions = {},
): SecurityAnalysisResult => {
  const analyzer = 'android-manifest';
  const evidence = evidenceFor(source, options.sourcePath);
  let document: Record<string, unknown>;
  try {
    document = parseXml(source);
  } catch (error) {
    return parseFailure(analyzer, evidence, options, error);
  }

  const manifest = recordValue(document.manifest);
  const application = records(manifest?.application)[0];
  if (!manifest || !application) {
    return parseFailure(
      analyzer,
      evidence,
      options,
      new TypeError('AndroidManifest.xml must contain manifest/application'),
    );
  }

  const findings: AssuranceFinding[] = [];
  const addBooleanPolicy = (policy: {
    attributeName: string;
    ruleId: string;
    unsafeTitle: string;
    safeTitle: string;
    description: string;
    severity: AssuranceFinding['severity'];
    controls: string[];
    remediation: string;
  }): void => {
    const value = booleanAttribute(application, policy.attributeName);
    if (value === true) {
      findings.push(
        finding({
          id: `${policy.ruleId}.unsafe`,
          ruleId: policy.ruleId,
          title: policy.unsafeTitle,
          description: policy.description,
          outcome: 'FAIL',
          severity: policy.severity,
          confidence: 0.99,
          controls: policy.controls,
          evidence,
          ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
          remediation: policy.remediation,
        }),
      );
    } else if (value === false && options.sourceKind === 'merged') {
      findings.push(
        finding({
          id: `${policy.ruleId}.safe`,
          ruleId: policy.ruleId,
          title: policy.safeTitle,
          description: `The merged manifest explicitly sets android:${policy.attributeName}="false".`,
          outcome: 'PASS',
          severity: 'info',
          confidence: 1,
          controls: policy.controls,
          evidence,
          ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
        }),
      );
    } else {
      const limitation =
        options.sourceKind === 'merged'
          ? `android:${policy.attributeName} is not explicit in the merged manifest`
          : 'Source manifests can be overridden by build variants and manifest merging';
      findings.push(
        finding({
          id: `${policy.ruleId}.not-verified`,
          ruleId: policy.ruleId,
          title: `${policy.safeTitle} was not verified`,
          description: policy.description,
          outcome: 'NOT_VERIFIED',
          severity: policy.severity,
          confidence: 1,
          controls: policy.controls,
          evidence,
          ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
          limitation,
        }),
      );
    }
  };

  addBooleanPolicy({
    attributeName: 'debuggable',
    ruleId: 'security.android.debuggable',
    unsafeTitle: 'Application is explicitly debuggable',
    safeTitle: 'Application debugging is disabled',
    description:
      'Debuggable production builds expose runtime inspection and debugging surfaces.',
    severity: 'high',
    controls: ['MASVS-RESILIENCE-2'],
    remediation:
      'Ensure the merged release manifest sets android:debuggable="false".',
  });
  addBooleanPolicy({
    attributeName: 'usesCleartextTraffic',
    ruleId: 'security.android.cleartext',
    unsafeTitle: 'Application explicitly permits cleartext traffic',
    safeTitle: 'Cleartext traffic is disabled',
    description:
      'Cleartext transport can expose application traffic to interception or modification.',
    severity: 'high',
    controls: ['MASVS-NETWORK-1'],
    remediation:
      'Set android:usesCleartextTraffic="false" and review the effective network security configuration.',
  });
  addBooleanPolicy({
    attributeName: 'allowBackup',
    ruleId: 'security.android.backup',
    unsafeTitle: 'Application explicitly allows platform backup',
    safeTitle: 'Platform backup is disabled',
    description:
      'Application backup can copy sensitive local data unless backup and extraction rules exclude it.',
    severity: 'medium',
    controls: ['MASVS-STORAGE-1'],
    remediation:
      'Disable backup or define and verify restrictive backup/data extraction rules for sensitive data.',
  });

  if (booleanAttribute(application, 'testOnly') === true) {
    findings.push(
      finding({
        id: 'security.android.test-only',
        ruleId: 'security.android.test-only',
        title: 'Application is marked testOnly',
        description:
          'A production artifact should not be installable only as a test package.',
        outcome: 'FAIL',
        severity: 'high',
        confidence: 1,
        controls: ['MASVS-CODE-1'],
        evidence,
        ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
        remediation:
          'Remove android:testOnly from the merged release manifest.',
      }),
    );
  }

  const networkSecurityConfig = attribute(application, 'networkSecurityConfig');
  if (networkSecurityConfig) {
    findings.push(
      finding({
        id: 'security.android.network-config-review',
        ruleId: 'security.android.network-config-review',
        title: 'Referenced network security configuration requires analysis',
        description:
          'The manifest references a separate network security XML resource.',
        outcome: 'NOT_VERIFIED',
        severity: 'high',
        confidence: 1,
        controls: ['MASVS-NETWORK-1'],
        evidence,
        ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
        limitation: `Referenced resource ${networkSecurityConfig} was not included in this manifest-only analysis`,
      }),
    );
  }

  const components: Array<{
    kind: 'activity' | 'activity-alias' | 'service' | 'receiver' | 'provider';
    value: Record<string, unknown>;
  }> = [];
  for (const kind of [
    'activity',
    'activity-alias',
    'service',
    'receiver',
    'provider',
  ] as const) {
    for (const value of records(application[kind]))
      components.push({ kind, value });
  }
  for (const [index, component] of components.entries()) {
    const exported = booleanAttribute(component.value, 'exported');
    if (exported === undefined && hasIntentFilter(component.value)) {
      findings.push(
        finding({
          id: `security.android.exported.implicit-${index + 1}`,
          ruleId: 'security.android.exported-explicit',
          title: `${component.kind} with intent filters has no explicit exported state`,
          description:
            'The effective exposure depends on target SDK, manifest merging, and component intent filters.',
          outcome: 'NOT_VERIFIED',
          severity: 'high',
          confidence: 1,
          controls: ['MASVS-PLATFORM-1'],
          evidence,
          ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
          limitation:
            'The effective merged manifest and target SDK were not supplied',
          remediation:
            'Set android:exported explicitly and verify the merged release manifest.',
        }),
      );
      continue;
    }
    if (exported !== true) continue;
    const permissions = [
      attribute(component.value, 'permission'),
      attribute(component.value, 'readPermission'),
      attribute(component.value, 'writePermission'),
    ].filter((value): value is string => value !== undefined);
    if (permissions.length > 0) continue;

    const publicActivity =
      (component.kind === 'activity' || component.kind === 'activity-alias') &&
      isPublicActivity(component.value);
    const definitiveExposure =
      component.kind === 'service' ||
      component.kind === 'receiver' ||
      component.kind === 'provider';
    const name = attribute(component.value, 'name') ?? component.kind;
    findings.push(
      finding({
        id: `security.android.exported.${index + 1}`,
        ruleId: 'security.android.exported-without-permission',
        title: `Exported ${component.kind} has no permission guard`,
        description: `${name} is exported without an explicit component permission.`,
        outcome: definitiveExposure ? 'FAIL' : 'NOT_VERIFIED',
        severity: definitiveExposure ? 'high' : 'medium',
        confidence: definitiveExposure ? 0.9 : 0.7,
        controls: ['MASVS-PLATFORM-1'],
        evidence,
        ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
        remediation:
          'Make the component non-exported or protect and validate every externally supplied input.',
        ...(!definitiveExposure
          ? {
              limitation: publicActivity
                ? 'Launcher or browsable activities may intentionally be public; authorization and input validation need runtime/source review'
                : 'Activity intent and authorization checks need source review',
            }
          : {}),
      }),
    );
  }

  for (const [index, permission] of records(
    manifest['uses-permission'],
  ).entries()) {
    const name = attribute(permission, 'name');
    const capability = name ? DANGEROUS_PERMISSION_REVIEW.get(name) : undefined;
    if (!name || !capability) continue;
    findings.push(
      finding({
        id: `security.android.permission-review.${index + 1}`,
        ruleId: 'security.android.permission-review',
        title: `Sensitive permission requires necessity review`,
        description: `${name} grants access to ${capability}.`,
        outcome: 'NOT_VERIFIED',
        severity: 'medium',
        confidence: 1,
        controls: ['MASVS-PRIVACY-1', 'MASVS-PLATFORM-1'],
        evidence,
        ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
        limitation:
          'Static manifest analysis cannot determine product necessity or runtime minimization',
        remediation:
          'Remove unnecessary permissions and verify just-in-time request, denial, and revocation behavior.',
      }),
    );
  }

  const limitations = [
    ...(options.sourceKind === 'merged'
      ? []
      : [
          'Source manifest findings must be confirmed against the merged release manifest',
        ]),
    ...(options.buildType === 'release'
      ? []
      : ['Release build type was not positively established']),
  ];
  return {
    schemaVersion: '1.0',
    analyzer,
    analyzedAt: options.analyzedAt ?? new Date().toISOString(),
    outcome: securityOutcome(findings),
    evidence: [evidence],
    findings,
    limitations,
  };
};

const walkConfigNodes = (
  value: unknown,
  output: Array<Record<string, unknown>>,
): void => {
  if (Array.isArray(value)) {
    for (const item of value) walkConfigNodes(item, output);
    return;
  }
  const record = recordValue(value);
  if (!record) return;
  output.push(record);
  for (const [key, child] of Object.entries(record)) {
    if (!key.startsWith('@_')) walkConfigNodes(child, output);
  }
};

export const analyzeNetworkSecurityConfig = (
  source: string,
  options: NetworkSecurityConfigAnalysisOptions = {},
): SecurityAnalysisResult => {
  const analyzer = 'android-network-security-config';
  const evidence = evidenceFor(source, options.sourcePath);
  let document: Record<string, unknown>;
  try {
    document = parseXml(source);
  } catch (error) {
    return parseFailure(analyzer, evidence, options, error);
  }
  const root = recordValue(document['network-security-config']);
  if (!root) {
    return parseFailure(
      analyzer,
      evidence,
      options,
      new TypeError('Expected network-security-config root element'),
    );
  }
  const nodes: Array<Record<string, unknown>> = [];
  walkConfigNodes(root, nodes);
  const findings: AssuranceFinding[] = [];
  const cleartextNodes = nodes.filter(
    (node) => booleanAttribute(node, 'cleartextTrafficPermitted') === true,
  );
  if (cleartextNodes.length > 0) {
    findings.push(
      finding({
        id: 'security.android.network.cleartext',
        ruleId: 'security.android.network.cleartext',
        title: 'Network security configuration permits cleartext traffic',
        description: `${cleartextNodes.length} configuration scope(s) explicitly allow cleartext traffic.`,
        outcome: 'FAIL',
        severity: 'high',
        confidence: 1,
        controls: ['MASVS-NETWORK-1'],
        evidence,
        ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
        remediation:
          'Disable cleartext traffic and migrate endpoints to authenticated TLS.',
      }),
    );
  } else {
    const explicitlySafe = nodes.some(
      (node) => booleanAttribute(node, 'cleartextTrafficPermitted') === false,
    );
    const outcome: AssuranceOutcome =
      explicitlySafe ||
      (options.targetSdk !== undefined && options.targetSdk >= 28)
        ? 'PASS'
        : 'NOT_VERIFIED';
    findings.push(
      finding({
        id: 'security.android.network.cleartext-safe',
        ruleId: 'security.android.network.cleartext',
        title:
          outcome === 'PASS'
            ? 'No cleartext allowance was found'
            : 'Cleartext default was not verified',
        description:
          'No configuration scope explicitly enables cleartext traffic.',
        outcome,
        severity: outcome === 'PASS' ? 'info' : 'high',
        confidence: 1,
        controls: ['MASVS-NETWORK-1'],
        evidence,
        ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
        ...(outcome === 'NOT_VERIFIED'
          ? {
              limitation:
                'targetSdk was not supplied and no explicit false policy was found',
            }
          : {}),
      }),
    );
  }

  const certificateSources = nodes
    .flatMap((node) => records(node.certificates))
    .map((certificate) => attribute(certificate, 'src'))
    .filter((value): value is string => value !== undefined);
  if (certificateSources.includes('user')) {
    findings.push(
      finding({
        id: 'security.android.network.user-ca',
        ruleId: 'security.android.network.user-ca',
        title: 'User-installed certificate authorities are trusted',
        description:
          'Trusting the user certificate store expands the production trust boundary.',
        outcome: 'FAIL',
        severity: 'high',
        confidence: 1,
        controls: ['MASVS-NETWORK-1'],
        evidence,
        ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
        remediation:
          'Restrict production trust anchors to required system or application-managed authorities.',
      }),
    );
  } else {
    findings.push(
      finding({
        id: 'security.android.network.no-user-ca',
        ruleId: 'security.android.network.user-ca',
        title: 'User-installed certificate authorities are not trusted',
        description: 'No user certificate trust anchor was found.',
        outcome: 'PASS',
        severity: 'info',
        confidence: 1,
        controls: ['MASVS-NETWORK-1'],
        evidence,
        ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
      }),
    );
  }

  if (root['debug-overrides'] !== undefined && options.buildType !== 'debug') {
    findings.push(
      finding({
        id: 'security.android.network.debug-overrides',
        ruleId: 'security.android.network.debug-overrides',
        title: 'Debug trust overrides require build-type verification',
        description:
          'Debug overrides are safe only when the effective production application is not debuggable.',
        outcome: 'NOT_VERIFIED',
        severity: 'high',
        confidence: 1,
        controls: ['MASVS-NETWORK-1', 'MASVS-RESILIENCE-2'],
        evidence,
        ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
        limitation:
          'Effective release debuggable state was not provided to this analyzer',
      }),
    );
  }

  return {
    schemaVersion: '1.0',
    analyzer,
    analyzedAt: options.analyzedAt ?? new Date().toISOString(),
    outcome: securityOutcome(findings),
    evidence: [evidence],
    findings,
    limitations: [],
  };
};
