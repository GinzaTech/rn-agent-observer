import {
  SuiteDefinitionSchema,
  type SuiteDefinition,
} from '@rn-agent-observer/schemas';

const defineSuite = (value: unknown): SuiteDefinition =>
  SuiteDefinitionSchema.parse(value);

export const BUILTIN_SUITES = {
  smoke: defineSuite({
    apiVersion: 'rn-observer/v1alpha1',
    kind: 'Suite',
    metadata: {
      id: 'builtin.smoke',
      name: 'React Native smoke evidence',
      description:
        'Verifies foreground process state, screen understanding, and source-correlated UI evidence.',
      tags: ['smoke', 'android', 'read-only'],
    },
    requirements: {
      platforms: ['android'],
      capabilities: ['device'],
    },
    steps: [
      {
        id: 'app-state',
        title: 'Verify the app process is foreground and running',
        action: { command: 'app-state' },
        requiredCapabilities: ['device'],
        assertions: [
          {
            id: 'process-running',
            title: 'Process is running',
            type: 'equals',
            path: 'processRunning',
            expected: true,
          },
          {
            id: 'foreground',
            title: 'App is foreground',
            type: 'equals',
            path: 'appInForeground',
            expected: true,
          },
        ],
      },
      {
        id: 'screen-understanding',
        title: 'Capture and understand the current screen',
        action: { command: 'understand-screen' },
        requiredCapabilities: ['screen-understanding'],
        assertions: [
          {
            id: 'screen-state',
            title: 'Screen state is available',
            type: 'exists',
            path: 'state',
            evidenceKinds: ['screen-understanding'],
          },
        ],
      },
      {
        id: 'runtime-ui-model',
        title: 'Correlate source and runtime UI',
        action: { command: 'ui-model' },
        requiredCapabilities: ['runtime-ui-model'],
        assertions: [
          {
            id: 'ui-nodes',
            title: 'Runtime UI nodes are available',
            type: 'exists',
            path: 'nodes',
            evidenceKinds: ['runtime-ui-model'],
          },
        ],
      },
    ],
    reporters: ['json', 'html', 'junit', 'github'],
  }),
  visual: defineSuite({
    apiVersion: 'rn-observer/v1alpha1',
    kind: 'Suite',
    metadata: {
      id: 'builtin.visual',
      name: 'Visual evidence capture',
      description:
        'Captures screenshot, UI tree, and screen understanding artifacts for a later baseline comparison.',
      tags: ['visual', 'android', 'read-only'],
    },
    requirements: {
      platforms: ['android'],
      capabilities: ['device', 'screenshot', 'ui-tree'],
    },
    steps: [
      {
        id: 'screenshot',
        title: 'Capture screenshot',
        action: { command: 'screenshot' },
        requiredCapabilities: ['screenshot'],
        assertions: [
          {
            id: 'screenshot-artifact',
            title: 'Screenshot artifact exists',
            type: 'exists',
            path: 'artifact.id',
            evidenceKinds: ['screenshot'],
          },
        ],
      },
      {
        id: 'screen-understanding',
        title: 'Capture structural screen evidence',
        action: { command: 'understand-screen' },
        requiredCapabilities: ['screen-understanding'],
      },
    ],
    reporters: ['json', 'html', 'junit', 'github'],
  }),
  performance: defineSuite({
    apiVersion: 'rn-observer/v1alpha1',
    kind: 'Suite',
    metadata: {
      id: 'builtin.performance',
      name: 'Repeated idle performance readiness',
      description:
        'Runs bounded repeated sampling. Idle results remain explicitly limited and do not replace exact-interaction profiling.',
      tags: ['performance', 'android', 'read-only'],
    },
    requirements: {
      platforms: ['android'],
      capabilities: ['device', 'performance'],
    },
    steps: [
      {
        id: 'performance-idle',
        title: 'Collect repeated performance samples',
        action: {
          command: 'performance-idle',
          input: {
            scenarioId: 'builtin-idle-readiness',
            samples: 5,
            warmupSamples: 1,
            intervalMs: 250,
          },
        },
        requiredCapabilities: ['performance'],
        timeoutMs: 120000,
      },
    ],
    reporters: ['json', 'html', 'junit', 'sarif', 'github'],
  }),
  network: defineSuite({
    apiVersion: 'rn-observer/v1alpha1',
    kind: 'Suite',
    metadata: {
      id: 'builtin.network',
      name: 'Observed network quality',
      description:
        'Evaluates failures and latency only from requests already evidenced by runtime telemetry.',
      tags: ['network', 'read-only'],
    },
    requirements: {
      platforms: ['android'],
      capabilities: ['device', 'logs'],
    },
    steps: [
      {
        id: 'network-summary',
        title: 'Summarize observed requests',
        action: { command: 'network-summary' },
        requiredCapabilities: ['logs'],
        assertions: [
          {
            id: 'failed-requests',
            title: 'No observed request failed',
            type: 'metric-budget',
            path: 'failedRequests',
            threshold: 0,
            unit: 'requests',
          },
          {
            id: 'p95-latency',
            title: 'Observed p95 latency stays below two seconds',
            type: 'metric-budget',
            path: 'p95Ms',
            threshold: 2000,
            unit: 'ms',
            onUnavailable: 'NOT_VERIFIED',
          },
        ],
      },
    ],
    reporters: ['json', 'html', 'junit', 'github'],
  }),
  accessibility: defineSuite({
    apiVersion: 'rn-observer/v1alpha1',
    kind: 'Suite',
    metadata: {
      id: 'builtin.accessibility',
      name: 'Android accessibility readiness',
      description:
        'Checks observed labels and touch targets; contrast, focus order, and assistive-technology behavior need additional evidence.',
      tags: ['accessibility', 'android', 'read-only'],
    },
    requirements: {
      platforms: ['android'],
      capabilities: ['device', 'ui-tree'],
    },
    steps: [
      {
        id: 'a11y-audit',
        title: 'Audit observed interactive controls',
        action: { command: 'a11y-audit' },
        requiredCapabilities: ['ui-tree'],
        assertions: [
          {
            id: 'labels',
            title: 'All observed controls have labels',
            type: 'metric-budget',
            path: 'counts.missingNames',
            threshold: 0,
            unit: 'controls',
          },
          {
            id: 'touch-targets',
            title: 'All observed touch targets meet minimum size',
            type: 'metric-budget',
            path: 'counts.smallTouchTargets',
            threshold: 0,
            unit: 'controls',
          },
        ],
      },
    ],
    reporters: ['json', 'html', 'junit', 'sarif', 'github'],
  }),
  security: defineSuite({
    apiVersion: 'rn-observer/v1alpha1',
    kind: 'Suite',
    metadata: {
      id: 'builtin.security',
      name: 'Passive Android security audit',
      description:
        'Runs read-only manifest, network-security, permission exposure, and redacted artifact secret checks.',
      tags: ['security', 'android', 'read-only', 'masvs'],
    },
    requirements: {
      platforms: ['android'],
      capabilities: ['security-passive'],
    },
    steps: [
      {
        id: 'passive-security',
        title: 'Run passive security analyzers',
        action: { command: 'security-audit' },
        requiredCapabilities: ['security-passive'],
      },
      {
        id: 'supply-chain-inventory',
        title: 'Generate a locked dependency SBOM',
        action: { command: 'security-sbom' },
        requiredCapabilities: ['security-passive'],
        assertions: [
          {
            id: 'sbom-artifact',
            title: 'CycloneDX SBOM artifact is available',
            type: 'exists',
            path: 'artifact.id',
            evidenceKinds: ['security-report'],
          },
        ],
      },
    ],
    reporters: ['json', 'html', 'junit', 'sarif', 'github'],
  }),
  resilience: defineSuite({
    apiVersion: 'rn-observer/v1alpha1',
    kind: 'Suite',
    metadata: {
      id: 'builtin.resilience',
      name: 'Read-only resilience readiness',
      description:
        'Verifies process/foreground and device-network evidence without injecting faults. Active fault scenarios require an authorized custom suite.',
      tags: ['resilience', 'android', 'read-only'],
    },
    requirements: {
      platforms: ['android'],
      capabilities: ['device', 'screen-understanding', 'logs'],
    },
    steps: [
      {
        id: 'resilience-readiness',
        title: 'Evaluate the current recovery checkpoint',
        action: { command: 'resilience-readiness' },
        requiredCapabilities: ['device', 'screen-understanding', 'logs'],
      },
    ],
    reporters: ['json', 'html', 'junit', 'github'],
  }),
} as const;

export type BuiltinSuiteName = keyof typeof BUILTIN_SUITES;

export const listBuiltinSuites = (): Array<{
  id: BuiltinSuiteName;
  name: string;
  description?: string;
  tags: string[];
}> =>
  (Object.keys(BUILTIN_SUITES) as BuiltinSuiteName[]).map((id) => {
    const suite = BUILTIN_SUITES[id];
    return {
      id,
      name: suite.metadata.name,
      ...(suite.metadata.description
        ? { description: suite.metadata.description }
        : {}),
      tags: [...suite.metadata.tags],
    };
  });

export const getBuiltinSuite = (name: string): SuiteDefinition | undefined => {
  if (!(name in BUILTIN_SUITES)) return undefined;
  return SuiteDefinitionSchema.parse(BUILTIN_SUITES[name as BuiltinSuiteName]);
};
