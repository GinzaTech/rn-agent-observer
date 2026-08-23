import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  SuiteRunResultSchema,
  type AssuranceFinding,
  type SuiteReporter,
  type SuiteRunResult,
  type SuiteStepResult,
} from '@rn-agent-observer/schemas';

export interface RenderedSuiteReport {
  reporter: SuiteReporter;
  extension: string;
  mimeType: string;
  content: string;
}

export interface WrittenSuiteReport {
  reporter: SuiteReporter;
  path: string;
  mimeType: string;
  sha256: string;
  bytes: number;
}

const xmlEscape = (value: unknown): string =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const htmlEscape = (value: unknown): string => xmlEscape(value);

const markdownEscape = (value: unknown): string =>
  String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

const durationSeconds = (step: SuiteStepResult): string =>
  (step.durationMs / 1000).toFixed(3);

const junitCase = (step: SuiteStepResult, className: string): string => {
  const detail = step.reason ?? `Outcome: ${step.outcome}`;
  const child =
    step.outcome === 'FAIL'
      ? `<failure message="${xmlEscape(detail)}"/>`
      : step.outcome === 'NOT_VERIFIED' || step.outcome === 'NA'
        ? `<skipped message="${xmlEscape(detail)}"/>`
        : '';
  return `<testcase classname="${xmlEscape(className)}" name="${xmlEscape(step.title)}" time="${durationSeconds(step)}">${child}</testcase>`;
};

const renderJunit = (run: SuiteRunResult): string => {
  const steps = [...run.steps, ...run.cleanup];
  const failures = steps.filter((step) => step.outcome === 'FAIL').length;
  const skipped = steps.filter(
    (step) => step.outcome === 'NOT_VERIFIED' || step.outcome === 'NA',
  ).length;
  const duration = steps.reduce((sum, step) => sum + step.durationMs, 0) / 1000;
  const cases = [
    ...run.steps.map((step) => junitCase(step, run.suiteId)),
    ...run.cleanup.map((step) => junitCase(step, `${run.suiteId}.cleanup`)),
  ].join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${xmlEscape(run.suiteId)}" tests="${steps.length}" failures="${failures}" skipped="${skipped}" time="${duration.toFixed(3)}">${cases}</testsuite>\n`;
};

const sarifLevel = (
  finding: AssuranceFinding,
): 'error' | 'warning' | 'note' => {
  if (finding.severity === 'critical' || finding.severity === 'high') {
    return 'error';
  }
  if (finding.severity === 'medium') return 'warning';
  return 'note';
};

const sarifResult = (finding: AssuranceFinding): Record<string, unknown> => {
  const result: Record<string, unknown> = {
    ruleId: finding.ruleId,
    level: sarifLevel(finding),
    message: {
      text:
        finding.outcome === 'NOT_VERIFIED'
          ? `${finding.title} (not verified): ${finding.description}`
          : `${finding.title}: ${finding.description}`,
    },
    properties: {
      outcome: finding.outcome,
      confidence: finding.confidence,
      category: finding.category,
      controls: finding.controls,
      evidenceIds: finding.evidence.map((reference) => reference.id),
      limitations: finding.limitations,
    },
  };
  if (finding.source) {
    result.locations = [
      {
        physicalLocation: {
          artifactLocation: { uri: finding.source.file.replaceAll('\\', '/') },
          ...(finding.source.line
            ? {
                region: {
                  startLine: finding.source.line,
                  ...(finding.source.column
                    ? { startColumn: finding.source.column }
                    : {}),
                },
              }
            : {}),
        },
      },
    ];
  }
  return result;
};

const renderSarif = (run: SuiteRunResult): string =>
  `${JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'RN Agent Observer',
              informationUri: 'https://github.com/GinzaTech/rn-agent-observer',
              rules: [
                ...new Set(run.findings.map((finding) => finding.ruleId)),
              ].map((ruleId) => ({ id: ruleId })),
            },
          },
          results: run.findings
            .filter(
              (finding) =>
                finding.outcome === 'FAIL' ||
                finding.outcome === 'NOT_VERIFIED',
            )
            .map(sarifResult),
        },
      ],
    },
    null,
    2,
  )}\n`;

const renderStepRows = (steps: readonly SuiteStepResult[]): string =>
  steps
    .map(
      (step) =>
        `<tr><td><code>${htmlEscape(step.id)}</code></td><td>${htmlEscape(step.title)}</td><td><span class="outcome ${htmlEscape(step.outcome.toLowerCase())}">${htmlEscape(step.outcome)}</span></td><td>${htmlEscape(step.durationMs)} ms</td><td>${htmlEscape(step.reason ?? '')}</td></tr>`,
    )
    .join('');

const renderFindingRows = (findings: readonly AssuranceFinding[]): string =>
  findings
    .map(
      (finding) =>
        `<tr><td><code>${htmlEscape(finding.ruleId)}</code></td><td>${htmlEscape(finding.title)}</td><td>${htmlEscape(finding.category)}</td><td>${htmlEscape(finding.severity)}</td><td><span class="outcome ${htmlEscape(finding.outcome.toLowerCase())}">${htmlEscape(finding.outcome)}</span></td></tr>`,
    )
    .join('');

const renderHtml = (run: SuiteRunResult): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>RN Agent Observer · ${htmlEscape(run.suiteId)}</title>
  <style>
    :root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}body{max-width:1100px;margin:0 auto;padding:32px;line-height:1.45}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}h1{margin:0 0 8px}code{font-family:ui-monospace,monospace}table{border-collapse:collapse;width:100%;margin:16px 0 32px}th,td{text-align:left;border-bottom:1px solid #8885;padding:10px;vertical-align:top}.outcome{font-weight:700}.pass{color:#16803c}.fail{color:#c42b1c}.not_verified{color:#9a6700}.na{color:#666}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.card{border:1px solid #8885;border-radius:10px;padding:14px}.limitations{border-left:4px solid #9a6700;padding-left:16px}
  </style>
</head>
<body>
  <header><div><h1>${htmlEscape(run.suiteId)}</h1><p>Evidence-based assurance report</p></div><strong class="outcome ${htmlEscape(run.outcome.toLowerCase())}">${htmlEscape(run.outcome)}</strong></header>
  <section class="meta"><div class="card"><strong>Run</strong><br><code>${htmlEscape(run.id)}</code></div><div class="card"><strong>Target</strong><br>${htmlEscape(run.target.platform)} · <code>${htmlEscape(run.target.appId)}</code></div><div class="card"><strong>Started</strong><br>${htmlEscape(run.startedAt)}</div></section>
  ${run.limitations.length > 0 ? `<section class="limitations"><h2>Limitations</h2><ul>${run.limitations.map((item) => `<li>${htmlEscape(item)}</li>`).join('')}</ul></section>` : ''}
  <h2>Steps</h2><table><thead><tr><th>ID</th><th>Step</th><th>Outcome</th><th>Duration</th><th>Reason</th></tr></thead><tbody>${renderStepRows(run.steps)}</tbody></table>
  ${run.cleanup.length > 0 ? `<h2>Cleanup</h2><table><thead><tr><th>ID</th><th>Step</th><th>Outcome</th><th>Duration</th><th>Reason</th></tr></thead><tbody>${renderStepRows(run.cleanup)}</tbody></table>` : ''}
  <h2>Findings</h2>${run.findings.length > 0 ? `<table><thead><tr><th>Rule</th><th>Finding</th><th>Category</th><th>Severity</th><th>Outcome</th></tr></thead><tbody>${renderFindingRows(run.findings)}</tbody></table>` : '<p>No findings were emitted.</p>'}
</body>
</html>
`;

const renderGithub = (run: SuiteRunResult): string => {
  const rows = [...run.steps, ...run.cleanup]
    .map(
      (step) =>
        `| ${markdownEscape(step.title)} | ${step.outcome} | ${step.durationMs} ms | ${markdownEscape(step.reason ?? '')} |`,
    )
    .join('\n');
  return `## RN Agent Observer · ${markdownEscape(run.suiteId)}\n\n**Outcome:** ${run.outcome}  \n**Run:** \`${markdownEscape(run.id)}\`  \n**Target:** \`${markdownEscape(run.target.appId)}\` on ${run.target.platform}\n\n| Step | Outcome | Duration | Detail |\n|---|---:|---:|---|\n${rows}\n\nFindings: ${run.findings.length}; limitations: ${run.limitations.length}.\n`;
};

export const renderSuiteReport = (
  value: SuiteRunResult,
  reporter: SuiteReporter,
): RenderedSuiteReport => {
  const run = SuiteRunResultSchema.parse(value);
  if (reporter === 'json') {
    return {
      reporter,
      extension: 'json',
      mimeType: 'application/json',
      content: `${JSON.stringify(run, null, 2)}\n`,
    };
  }
  if (reporter === 'junit') {
    return {
      reporter,
      extension: 'xml',
      mimeType: 'application/xml',
      content: renderJunit(run),
    };
  }
  if (reporter === 'sarif') {
    return {
      reporter,
      extension: 'sarif',
      mimeType: 'application/sarif+json',
      content: renderSarif(run),
    };
  }
  if (reporter === 'html') {
    return {
      reporter,
      extension: 'html',
      mimeType: 'text/html',
      content: renderHtml(run),
    };
  }
  return {
    reporter,
    extension: 'md',
    mimeType: 'text/markdown',
    content: renderGithub(run),
  };
};

export const writeSuiteReports = async (
  value: SuiteRunResult,
  options: {
    outputDirectory: string;
    reporters: readonly SuiteReporter[];
    basename?: string;
  },
): Promise<WrittenSuiteReport[]> => {
  const run = SuiteRunResultSchema.parse(value);
  const outputDirectory = resolve(options.outputDirectory);
  const basename = (options.basename ?? run.id).replace(
    /[^a-zA-Z0-9._-]/gu,
    '_',
  );
  if (!basename || basename === '.' || basename === '..') {
    throw new Error('Report basename must contain a safe filename character');
  }
  await mkdir(outputDirectory, { recursive: true });

  const written: WrittenSuiteReport[] = [];
  for (const reporter of [...new Set(options.reporters)]) {
    const report = renderSuiteReport(run, reporter);
    const path = resolve(outputDirectory, `${basename}.${report.extension}`);
    const relation = relative(outputDirectory, path);
    if (
      relation === '..' ||
      relation.startsWith(`..${sep}`) ||
      isAbsolute(relation)
    ) {
      throw new Error('Report path escaped the output directory');
    }
    await writeFile(path, report.content, 'utf8');
    written.push({
      reporter,
      path,
      mimeType: report.mimeType,
      sha256: createHash('sha256').update(report.content).digest('hex'),
      bytes: Buffer.byteLength(report.content),
    });
  }
  return written;
};
