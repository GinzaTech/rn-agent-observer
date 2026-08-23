import { AssuranceFindingSchema } from '@rn-agent-observer/schemas';
import {
  PluginManifestError,
  parseExternalPluginManifest,
  validatePluginManifest,
  type PluginValidationIssue,
  type PluginValidationResult,
} from './manifest.js';
import {
  EXTERNAL_PLUGIN_METHODS,
  type AnalyzerExtension,
  type AnalyzerResult,
  type ExternalPluginDescriptor,
  type InProcessExtension,
  type PluginConformanceReport,
  type PluginLifecycle,
  type ReporterExtension,
  type ReporterArtifact,
  type ReporterResult,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(
  issues: PluginValidationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

function validateLifecycleHooks(
  input: Record<string, unknown>,
  issues: PluginValidationIssue[],
): void {
  for (const hook of ['initialize', 'dispose'] as const) {
    if (input[hook] !== undefined && typeof input[hook] !== 'function') {
      issue(
        issues,
        `extension.${hook}`,
        'invalid_lifecycle_hook',
        'must be a function when provided',
      );
    }
  }
}

export function validateInProcessExtension(
  input: unknown,
): PluginValidationResult<InProcessExtension> {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [
        {
          path: 'extension',
          code: 'required_object',
          message: 'must be an object',
        },
      ],
    };
  }

  const manifestResult = validatePluginManifest(input.manifest);
  if (!manifestResult.success) return manifestResult;
  const issues: PluginValidationIssue[] = [];
  const manifest = manifestResult.value;
  if (manifest.execution.mode !== 'in-process') {
    issue(
      issues,
      'extension.manifest.execution.mode',
      'in_process_required',
      'registry extensions must use trusted in-process execution',
    );
  } else if (manifest.kind === 'analyzer') {
    if (typeof input.analyze !== 'function') {
      issue(
        issues,
        'extension.analyze',
        'missing_analyze',
        'analyzer extensions must implement analyze()',
      );
    }
  } else if (manifest.kind === 'reporter') {
    if (typeof input.report !== 'function') {
      issue(
        issues,
        'extension.report',
        'missing_report',
        'reporter extensions must implement report()',
      );
    }
  }
  validateLifecycleHooks(input, issues);
  if (issues.length > 0) return { success: false, issues };
  if (manifest.kind !== 'analyzer' && manifest.kind !== 'reporter') {
    return {
      success: false,
      issues: [
        {
          path: 'extension.manifest.kind',
          code: 'in_process_kind_required',
          message: 'must be analyzer or reporter',
        },
      ],
    };
  }
  const initialize = input.initialize as PluginLifecycle['initialize'];
  const dispose = input.dispose as PluginLifecycle['dispose'];
  if (manifest.kind === 'analyzer') {
    const analyze = input.analyze as AnalyzerExtension['analyze'];
    return {
      success: true,
      value: {
        manifest,
        analyze: (request, context) => analyze.call(input, request, context),
        ...(initialize === undefined
          ? {}
          : {
              initialize: (context) => initialize.call(input, context),
            }),
        ...(dispose === undefined
          ? {}
          : { dispose: (context) => dispose.call(input, context) }),
      },
    };
  }
  const report = input.report as ReporterExtension['report'];
  return {
    success: true,
    value: {
      manifest,
      report: (request, context) => report.call(input, request, context),
      ...(initialize === undefined
        ? {}
        : { initialize: (context) => initialize.call(input, context) }),
      ...(dispose === undefined
        ? {}
        : { dispose: (context) => dispose.call(input, context) }),
    },
  };
}

export function parseInProcessExtension(input: unknown): InProcessExtension {
  const result = validateInProcessExtension(input);
  if (!result.success) throw new PluginManifestError(result.issues);
  return result.value;
}

export function createExternalPluginDescriptor(
  input: unknown,
): ExternalPluginDescriptor {
  const manifest = parseExternalPluginManifest(input);
  return {
    manifest,
    methods:
      manifest.kind === 'provider'
        ? [
            EXTERNAL_PLUGIN_METHODS.initialize,
            EXTERNAL_PLUGIN_METHODS.capabilities,
            EXTERNAL_PLUGIN_METHODS.providerCollect,
            EXTERNAL_PLUGIN_METHODS.dispose,
          ]
        : [
            EXTERNAL_PLUGIN_METHODS.initialize,
            EXTERNAL_PLUGIN_METHODS.capabilities,
            EXTERNAL_PLUGIN_METHODS.actionExecute,
            EXTERNAL_PLUGIN_METHODS.dispose,
          ],
  };
}

export function inspectPluginConformance(
  input: unknown,
): PluginConformanceReport {
  const extensionRecord = isRecord(input) ? input : undefined;
  const manifestInput = extensionRecord?.manifest ?? input;
  const manifestResult = validatePluginManifest(manifestInput);
  if (!manifestResult.success) {
    return {
      valid: false,
      kind: null,
      pluginId: null,
      issues: manifestResult.issues,
    };
  }
  if (manifestResult.value.execution.mode === 'external-process') {
    return {
      valid: true,
      kind: manifestResult.value.kind,
      pluginId: manifestResult.value.id,
      issues: [],
    };
  }
  const extensionResult = validateInProcessExtension(input);
  return extensionResult.success
    ? {
        valid: true,
        kind: manifestResult.value.kind,
        pluginId: manifestResult.value.id,
        issues: [],
      }
    : {
        valid: false,
        kind: manifestResult.value.kind,
        pluginId: manifestResult.value.id,
        issues: extensionResult.issues,
      };
}

export function parseAnalyzerResult(input: unknown): AnalyzerResult {
  const issues: PluginValidationIssue[] = [];
  if (!isRecord(input)) {
    throw new PluginManifestError([
      {
        path: 'analyzerResult',
        code: 'required_object',
        message: 'must be an object',
      },
    ]);
  }
  if (!Array.isArray(input.findings)) {
    issue(
      issues,
      'analyzerResult.findings',
      'required_array',
      'must be an array',
    );
  }
  const findings = Array.isArray(input.findings)
    ? input.findings.flatMap((finding, index) => {
        const result = AssuranceFindingSchema.safeParse(finding);
        if (!result.success) {
          for (const entry of result.error.issues) {
            issue(
              issues,
              `analyzerResult.findings[${index}].${entry.path.join('.')}`,
              'invalid_finding',
              entry.message,
            );
          }
          return [];
        }
        return [result.data];
      })
    : [];
  if (input.metadata !== undefined && !isRecord(input.metadata)) {
    issue(
      issues,
      'analyzerResult.metadata',
      'invalid_metadata',
      'must be an object when provided',
    );
  }
  if (issues.length > 0) throw new PluginManifestError(issues);
  return {
    findings,
    ...(isRecord(input.metadata) ? { metadata: input.metadata } : {}),
  };
}

function parseReporterArtifact(
  input: unknown,
  index: number,
  issues: PluginValidationIssue[],
): ReporterArtifact | undefined {
  if (!isRecord(input)) {
    issue(
      issues,
      `reporterResult.artifacts[${index}]`,
      'required_object',
      'must be an object',
    );
    return undefined;
  }
  if (typeof input.path !== 'string' || input.path.trim().length === 0) {
    issue(
      issues,
      `reporterResult.artifacts[${index}].path`,
      'required_string',
      'must be a non-empty path',
    );
    return undefined;
  }
  if (
    input.mimeType !== undefined &&
    (typeof input.mimeType !== 'string' || input.mimeType.trim().length === 0)
  ) {
    issue(
      issues,
      `reporterResult.artifacts[${index}].mimeType`,
      'invalid_string',
      'must be a non-empty string when provided',
    );
  }
  if (
    input.label !== undefined &&
    (typeof input.label !== 'string' || input.label.trim().length === 0)
  ) {
    issue(
      issues,
      `reporterResult.artifacts[${index}].label`,
      'invalid_string',
      'must be a non-empty string when provided',
    );
  }
  return {
    path: input.path,
    ...(typeof input.mimeType === 'string' ? { mimeType: input.mimeType } : {}),
    ...(typeof input.label === 'string' ? { label: input.label } : {}),
  };
}

export function parseReporterResult(input: unknown): ReporterResult {
  const issues: PluginValidationIssue[] = [];
  if (!isRecord(input)) {
    throw new PluginManifestError([
      {
        path: 'reporterResult',
        code: 'required_object',
        message: 'must be an object',
      },
    ]);
  }
  if (!Array.isArray(input.artifacts)) {
    issue(
      issues,
      'reporterResult.artifacts',
      'required_array',
      'must be an array',
    );
  }
  const artifacts = Array.isArray(input.artifacts)
    ? input.artifacts.flatMap((artifact, index) => {
        const parsed = parseReporterArtifact(artifact, index, issues);
        return parsed ? [parsed] : [];
      })
    : [];
  if (
    input.summary !== undefined &&
    (typeof input.summary !== 'string' || input.summary.trim().length === 0)
  ) {
    issue(
      issues,
      'reporterResult.summary',
      'invalid_string',
      'must be a non-empty string when provided',
    );
  }
  if (input.metadata !== undefined && !isRecord(input.metadata)) {
    issue(
      issues,
      'reporterResult.metadata',
      'invalid_metadata',
      'must be an object when provided',
    );
  }
  if (issues.length > 0) throw new PluginManifestError(issues);
  return {
    artifacts,
    ...(typeof input.summary === 'string' ? { summary: input.summary } : {}),
    ...(isRecord(input.metadata) ? { metadata: input.metadata } : {}),
  };
}
