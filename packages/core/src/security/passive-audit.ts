import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { AssuranceFinding } from '@rn-agent-observer/schemas';
import {
  analyzeAndroidManifest,
  analyzeNetworkSecurityConfig,
} from './android-manifest.js';
import {
  MAX_SECRET_SCAN_BYTES,
  scanSecrets,
  type SecretScanResult,
} from './secret-scanner.js';
import { securityOutcome, type SecurityAnalysisResult } from './types.js';

export const MAX_PASSIVE_AUDIT_FILES = 500;
export const MAX_PASSIVE_AUDIT_BYTES = 20 * 1024 * 1024;

export interface PassiveSecurityAuditOptions {
  projectRoot: string;
  artifactRoot?: string;
  manifestPaths?: readonly string[];
  networkSecurityConfigPaths?: readonly string[];
  textPaths?: readonly string[];
  scanArtifacts?: boolean;
  maxFiles?: number;
  maxTotalBytes?: number;
  fingerprintKey?: string | Uint8Array;
  analyzedAt?: string;
}

export interface PassiveSecurityAuditResult extends SecurityAnalysisResult {
  projectRoot: string;
  filesAnalyzed: string[];
  manifestAnalyses: SecurityAnalysisResult[];
  networkSecurityAnalyses: SecurityAnalysisResult[];
  secretScans: SecretScanResult[];
  totals: {
    files: number;
    bytes: number;
    findings: number;
  };
}

const safePath = (root: string, value: string): string => {
  const rootPath = resolve(root);
  const path = resolve(rootPath, value);
  const relation = relative(rootPath, path);
  if (
    relation === '..' ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new TypeError(
      `Security audit path must stay within project root: ${value}`,
    );
  }
  if (existsSync(path)) {
    const realRoot = realpathSync(rootPath);
    const realPath = realpathSync(path);
    const realRelation = relative(realRoot, realPath);
    if (
      realRelation === '..' ||
      realRelation.startsWith(`..${sep}`) ||
      isAbsolute(realRelation)
    ) {
      throw new TypeError(
        `Security audit path resolves outside project root: ${value}`,
      );
    }
  }
  return path;
};

const uniqueExistingFiles = (paths: readonly string[]): string[] => [
  ...new Set(
    paths
      .filter((path) => existsSync(path) && lstatSync(path).isFile())
      .map((path) => resolve(path)),
  ),
];

const findFiles = (
  directory: string,
  predicate: (path: string) => boolean,
  limit: number,
): string[] => {
  if (!existsSync(directory) || limit <= 0) return [];
  const output: string[] = [];
  const pending: string[] = [directory];
  while (pending.length > 0 && output.length < limit) {
    const current = pending.pop();
    if (!current) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && predicate(path)) output.push(path);
      if (output.length >= limit) break;
    }
  }
  return output;
};

const defaultManifestPaths = (projectRoot: string): string[] => {
  const mergedRoot = join(
    projectRoot,
    'android',
    'app',
    'build',
    'intermediates',
  );
  const mergedRelease = findFiles(
    mergedRoot,
    (path) =>
      path.endsWith('AndroidManifest.xml') &&
      path.toLowerCase().includes('release') &&
      path.toLowerCase().includes('merged'),
    20,
  );
  if (mergedRelease.length > 0) return mergedRelease;
  return [
    join(projectRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  ];
};

const referencedNetworkConfigPaths = (
  projectRoot: string,
  manifests: readonly string[],
): string[] => {
  const output: string[] = [];
  for (const manifest of manifests) {
    const source = readFileSync(manifest, 'utf8');
    const name = source.match(
      /android:networkSecurityConfig\s*=\s*["']@xml\/([a-zA-Z0-9_]+)["']/u,
    )?.[1];
    if (name) {
      output.push(
        join(
          projectRoot,
          'android',
          'app',
          'src',
          'main',
          'res',
          'xml',
          `${name}.xml`,
        ),
      );
    }
  }
  return output;
};

const ARTIFACT_TEXT_EXTENSIONS = new Set([
  '.json',
  '.jsonl',
  '.log',
  '.md',
  '.ndjson',
  '.txt',
  '.xml',
]);

const withUniqueFindingIds = (
  findings: readonly AssuranceFinding[],
  suffix: string,
): AssuranceFinding[] =>
  findings.map((finding) => ({ ...finding, id: `${finding.id}.${suffix}` }));

export const runPassiveSecurityAudit = (
  options: PassiveSecurityAuditOptions,
): PassiveSecurityAuditResult => {
  const projectRoot = resolve(options.projectRoot);
  const analyzedAt = options.analyzedAt ?? new Date().toISOString();
  const maxFiles = Math.min(
    Math.max(1, options.maxFiles ?? MAX_PASSIVE_AUDIT_FILES),
    MAX_PASSIVE_AUDIT_FILES,
  );
  const maxTotalBytes = Math.min(
    Math.max(1, options.maxTotalBytes ?? MAX_PASSIVE_AUDIT_BYTES),
    MAX_PASSIVE_AUDIT_BYTES,
  );
  const limitations: string[] = [];

  const manifestCandidates = options.manifestPaths
    ? options.manifestPaths.map((path) => safePath(projectRoot, path))
    : defaultManifestPaths(projectRoot);
  const manifests = uniqueExistingFiles(manifestCandidates).slice(0, maxFiles);
  if (manifests.length === 0) {
    limitations.push(
      'No Android manifest was found; manifest checks were not verified',
    );
  }

  const networkCandidates = options.networkSecurityConfigPaths
    ? options.networkSecurityConfigPaths.map((path) =>
        safePath(projectRoot, path),
      )
    : referencedNetworkConfigPaths(projectRoot, manifests);
  const networkConfigs = uniqueExistingFiles(networkCandidates).slice(
    0,
    Math.max(0, maxFiles - manifests.length),
  );
  if (networkCandidates.length > 0 && networkConfigs.length === 0) {
    limitations.push(
      'A network security configuration was referenced but its XML file was not found',
    );
  }

  const explicitTextPaths = (options.textPaths ?? []).map((path) =>
    safePath(projectRoot, path),
  );
  const artifactRoot = options.artifactRoot
    ? safePath(projectRoot, options.artifactRoot)
    : join(projectRoot, '.artifacts');
  const artifactPaths =
    options.scanArtifacts === false
      ? []
      : findFiles(
          artifactRoot,
          (path) => ARTIFACT_TEXT_EXTENSIONS.has(extname(path).toLowerCase()),
          Math.max(0, maxFiles - manifests.length - networkConfigs.length),
        );
  const textPaths = uniqueExistingFiles([
    ...explicitTextPaths,
    ...artifactPaths,
  ]).filter(
    (path) => !manifests.includes(path) && !networkConfigs.includes(path),
  );

  const manifestAnalyses: SecurityAnalysisResult[] = [];
  const networkSecurityAnalyses: SecurityAnalysisResult[] = [];
  const secretScans: SecretScanResult[] = [];
  let bytes = 0;
  const filesAnalyzed: string[] = [];
  const consume = (path: string): string | undefined => {
    if (filesAnalyzed.length >= maxFiles) {
      limitations.push(`File limit ${maxFiles} reached`);
      return undefined;
    }
    const source = readFileSync(path, 'utf8');
    const size = Buffer.byteLength(source, 'utf8');
    if (bytes + size > maxTotalBytes) {
      limitations.push(
        `Total input limit ${maxTotalBytes} bytes reached before ${path}`,
      );
      return undefined;
    }
    bytes += size;
    filesAnalyzed.push(path);
    return source;
  };

  for (const path of manifests) {
    const source = consume(path);
    if (source === undefined) continue;
    const lower = path.toLowerCase();
    manifestAnalyses.push(
      analyzeAndroidManifest(source, {
        sourcePath: path,
        sourceKind: lower.includes('merged') ? 'merged' : 'source',
        buildType: lower.includes('release') ? 'release' : 'unknown',
        analyzedAt,
      }),
    );
  }
  for (const path of networkConfigs) {
    const source = consume(path);
    if (source === undefined) continue;
    networkSecurityAnalyses.push(
      analyzeNetworkSecurityConfig(source, {
        sourcePath: path,
        buildType: path.toLowerCase().includes('debug') ? 'debug' : 'unknown',
        analyzedAt,
      }),
    );
  }
  for (const path of textPaths) {
    const source = consume(path);
    if (source === undefined) continue;
    secretScans.push(
      scanSecrets(source, {
        source: path,
        analyzedAt,
        ...(options.fingerprintKey
          ? { fingerprintKey: options.fingerprintKey }
          : {}),
        maxBytes: MAX_SECRET_SCAN_BYTES,
      }),
    );
  }

  const analyses: SecurityAnalysisResult[] = [
    ...manifestAnalyses,
    ...networkSecurityAnalyses,
    ...secretScans,
  ];
  const findings = analyses.flatMap((analysis, index) =>
    withUniqueFindingIds(analysis.findings, String(index + 1)),
  );
  if (manifests.length === 0) {
    findings.push({
      schemaVersion: '1.0',
      id: 'security.android.manifest-missing',
      ruleId: 'security.android.manifest-missing',
      title: 'Android manifest checks were not run',
      description: 'No AndroidManifest.xml was available in the project.',
      outcome: 'NOT_VERIFIED',
      severity: 'high',
      confidence: 1,
      category: 'security',
      controls: ['MASVS-PLATFORM-1'],
      evidence: [],
      limitations: ['Android manifest was unavailable'],
    });
  }

  return {
    schemaVersion: '1.0',
    analyzer: 'passive-security-audit',
    analyzedAt,
    outcome: securityOutcome(findings),
    evidence: analyses.flatMap((analysis) => analysis.evidence),
    findings,
    limitations: [
      ...new Set([
        ...limitations,
        ...analyses.flatMap((analysis) => analysis.limitations),
      ]),
    ],
    projectRoot,
    filesAnalyzed,
    manifestAnalyses,
    networkSecurityAnalyses,
    secretScans,
    totals: { files: filesAnalyzed.length, bytes, findings: findings.length },
  };
};
