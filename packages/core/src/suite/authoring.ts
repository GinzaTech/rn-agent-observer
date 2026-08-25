import { writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  SuiteDefinitionSchema,
  type SuiteDefinition,
  type SuiteRisk,
} from '@rn-agent-observer/schemas';
import { stringify } from 'yaml';
import {
  resolveContainedReadFile,
  resolveNewProjectOutputFile,
} from '../filesystem/path-authority.js';
import { loadSuiteDefinition } from './loader.js';

export const STARTER_SUITE_PROFILES = ['smoke', 'performance'] as const;
export type StarterSuiteProfile = (typeof STARTER_SUITE_PROFILES)[number];

export interface SuiteInspection {
  valid: true;
  source: {
    path: string;
    format: 'json' | 'yaml';
    sha256: string;
  };
  suite: {
    id: string;
    name: string;
    description?: string;
    tags: string[];
    platforms: string[];
    enhancedInstrumentation: boolean;
    steps: number;
    cleanupSteps: number;
    assertions: number;
    risks: SuiteRisk[];
    requiredCapabilities: string[];
    reporters: string[];
  };
}

const defineSuite = (value: unknown): SuiteDefinition =>
  SuiteDefinitionSchema.parse(value);

export const createStarterSuite = (
  profile: StarterSuiteProfile,
): SuiteDefinition => {
  if (profile === 'performance') {
    return defineSuite({
      apiVersion: 'rn-observer/v1alpha1',
      kind: 'Suite',
      metadata: {
        id: 'project.performance',
        name: 'Project performance evidence',
        description:
          'Collects repeated idle samples. Replace or extend this with an exact replay before treating it as interaction performance.',
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
              scenarioId: 'project-idle',
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
    });
  }

  return defineSuite({
    apiVersion: 'rn-observer/v1alpha1',
    kind: 'Suite',
    metadata: {
      id: 'project.smoke',
      name: 'Project smoke evidence',
      description:
        'Read-only foreground, screen, and accessibility evidence for an owned React Native or Expo app.',
      tags: ['smoke', 'android', 'read-only'],
    },
    requirements: {
      platforms: ['android'],
      capabilities: ['device', 'screen-understanding', 'ui-tree'],
    },
    steps: [
      {
        id: 'app-state',
        title: 'Verify the target app is foreground',
        action: { command: 'app-state' },
        requiredCapabilities: ['device'],
        assertions: [
          {
            id: 'process-running',
            title: 'Target process is running',
            type: 'equals',
            path: 'processRunning',
            expected: true,
          },
          {
            id: 'foreground',
            title: 'Target app is foreground',
            type: 'equals',
            path: 'appInForeground',
            expected: true,
          },
        ],
      },
      {
        id: 'screen',
        title: 'Understand the current screen',
        action: { command: 'understand-screen' },
        requiredCapabilities: ['screen-understanding'],
        assertions: [
          {
            id: 'screen-state',
            title: 'Screen state is observable',
            type: 'exists',
            path: 'state',
            evidenceKinds: ['screen-understanding'],
          },
        ],
      },
      {
        id: 'accessibility',
        title: 'Audit observed controls',
        action: { command: 'a11y-audit' },
        requiredCapabilities: ['ui-tree'],
        assertions: [
          {
            id: 'labels',
            title: 'Observed controls have accessible names',
            type: 'metric-budget',
            path: 'counts.missingNames',
            threshold: 0,
            unit: 'controls',
          },
        ],
      },
    ],
    reporters: ['json', 'html', 'junit', 'sarif', 'github'],
  });
};

const inspect = (
  definition: SuiteDefinition,
  source: SuiteInspection['source'],
): SuiteInspection => {
  const steps = [...definition.steps, ...definition.cleanup];
  return {
    valid: true,
    source,
    suite: {
      id: definition.metadata.id,
      name: definition.metadata.name,
      ...(definition.metadata.description
        ? { description: definition.metadata.description }
        : {}),
      tags: definition.metadata.tags,
      platforms: definition.requirements.platforms,
      enhancedInstrumentation: definition.requirements.enhancedInstrumentation,
      steps: definition.steps.length,
      cleanupSteps: definition.cleanup.length,
      assertions: steps.reduce(
        (count, step) => count + step.assertions.length,
        0,
      ),
      risks: [...new Set(steps.map((step) => step.risk))],
      requiredCapabilities: [
        ...new Set([
          ...definition.requirements.capabilities,
          ...steps.flatMap((step) => step.requiredCapabilities),
        ]),
      ].sort(),
      reporters: definition.reporters,
    },
  };
};

export const inspectSuiteFile = async (
  projectRoot: string,
  requestedPath: string,
): Promise<SuiteInspection> => {
  const path = resolveContainedReadFile(
    projectRoot,
    requestedPath,
    'suite path',
  );
  const loaded = await loadSuiteDefinition(path);
  return inspect(loaded.definition, {
    path: loaded.path,
    format: loaded.format,
    sha256: loaded.sha256,
  });
};

export const writeStarterSuite = async (
  projectRoot: string,
  requestedPath: string,
  profile: StarterSuiteProfile,
): Promise<SuiteInspection> => {
  const extension = extname(requestedPath).toLowerCase();
  if (!['.json', '.yaml', '.yml'].includes(extension)) {
    throw new TypeError('Starter suite path must use .json, .yaml, or .yml');
  }
  const path = resolveNewProjectOutputFile(
    projectRoot,
    requestedPath,
    'starter suite path',
  );
  const definition = createStarterSuite(profile);
  const source =
    extension === '.json'
      ? `${JSON.stringify(definition, null, 2)}\n`
      : stringify(definition, { lineWidth: 0 });
  await writeFile(path, source, { encoding: 'utf8', flag: 'wx' });
  return inspectSuiteFile(projectRoot, path);
};
