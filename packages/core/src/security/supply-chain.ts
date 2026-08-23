import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
  AssuranceFindingSchema,
  type AssuranceFinding,
  type AssuranceOutcome,
  type EvidenceReference,
} from '@rn-agent-observer/schemas';
import { parseDocument } from 'yaml';

export const CYCLONEDX_SPEC_VERSION = '1.6' as const;
export const OSV_QUERY_BATCH_ENDPOINT = 'https://api.osv.dev/v1/querybatch';
export const MAX_LOCKFILE_BYTES = 20 * 1_048_576;
export const MAX_OSV_RESPONSE_BYTES = 8 * 1_048_576;
export const MAX_OSV_COMPONENTS = 1_000;
export const OSV_BATCH_SIZE = 250;

export interface CycloneDxHash {
  alg: 'SHA-256' | 'SHA-384' | 'SHA-512';
  content: string;
}

export interface CycloneDxComponent {
  type: 'application' | 'library';
  'bom-ref': string;
  group?: string;
  name: string;
  version: string;
  purl: string;
  hashes?: CycloneDxHash[];
}

export interface CycloneDxDependency {
  ref: string;
  dependsOn: string[];
}

export interface CycloneDxBom {
  bomFormat: 'CycloneDX';
  specVersion: typeof CYCLONEDX_SPEC_VERSION;
  serialNumber: string;
  version: 1;
  metadata: {
    timestamp: string;
    component: CycloneDxComponent;
  };
  components: CycloneDxComponent[];
  dependencies: CycloneDxDependency[];
}

export interface SupplyChainInventory {
  schemaVersion: '1.0';
  analyzer: 'pnpm-cyclonedx-inventory';
  lockfilePath: string;
  componentCount: number;
  sha256: string;
  bom: CycloneDxBom;
  limitations: string[];
}

export interface GenerateSupplyChainInventoryOptions {
  projectRoot: string;
  lockfilePath?: string;
  now?: () => Date;
  serialNumber?: string;
}

export interface OsvAdvisoryReference {
  id: string;
  modified?: string;
  component: {
    name: string;
    version: string;
    purl: string;
  };
}

export interface OsvDependencyAuditResult {
  schemaVersion: '1.0';
  analyzer: 'osv-dependency-audit';
  generatedAt: string;
  endpoint: string;
  outcome: AssuranceOutcome;
  queriedComponents: number;
  advisories: OsvAdvisoryReference[];
  findings: AssuranceFinding[];
  evidence: EvidenceReference[];
  limitations: string[];
}

export interface AuditOsvDependenciesOptions {
  inventory: SupplyChainInventory;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxComponents?: number;
  signal?: AbortSignal;
  now?: () => Date;
  onProgress?: (progress: {
    completed: number;
    total: number;
  }) => void | Promise<void>;
}

interface ParsedPackageKey {
  name: string;
  version: string;
  purl: string;
  group?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : undefined;
}

function stripPeerContext(version: string): string {
  const peerStart = version.indexOf('(');
  return (peerStart >= 0 ? version.slice(0, peerStart) : version).trim();
}

function packagePurl(name: string, version: string): string {
  if (name.startsWith('@')) {
    const slash = name.indexOf('/');
    if (slash > 1) {
      return `pkg:npm/${encodeURIComponent(name.slice(0, slash))}/${encodeURIComponent(name.slice(slash + 1))}@${encodeURIComponent(version)}`;
    }
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function parsePackageKey(key: string): ParsedPackageKey | undefined {
  const normalized = stripPeerContext(key);
  const separator = normalized.lastIndexOf('@');
  if (separator <= 0 || separator === normalized.length - 1) return undefined;
  const name = normalized.slice(0, separator);
  const version = normalized.slice(separator + 1);
  if (version.startsWith('link:') || version.startsWith('workspace:')) {
    return undefined;
  }
  const group = name.startsWith('@') ? name.slice(0, name.indexOf('/')) : '';
  return {
    name,
    version,
    purl: packagePurl(name, version),
    ...(group ? { group } : {}),
  };
}

function integrityHashes(value: unknown): CycloneDxHash[] | undefined {
  if (!isRecord(value)) return undefined;
  const integrity = readString(value, 'integrity');
  if (!integrity) return undefined;
  const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/u.exec(integrity);
  if (!match) return undefined;
  const algorithm = match[1];
  const digest = match[2];
  if (!algorithm || !digest) return undefined;
  const alg = {
    sha256: 'SHA-256',
    sha384: 'SHA-384',
    sha512: 'SHA-512',
  }[algorithm] as CycloneDxHash['alg'];
  return [{ alg, content: Buffer.from(digest, 'base64').toString('hex') }];
}

function resolvedDependencyVersion(value: unknown): string | undefined {
  if (typeof value === 'string') return stripPeerContext(value);
  if (!isRecord(value)) return undefined;
  const version = readString(value, 'version');
  return version ? stripPeerContext(version) : undefined;
}

function dependenciesFrom(
  value: unknown,
  componentRefs: ReadonlySet<string>,
): string[] {
  if (!isRecord(value)) return [];
  const dependencies = ['dependencies', 'optionalDependencies'].flatMap(
    (key) => {
      const group = value[key];
      if (!isRecord(group)) return [];
      return Object.entries(group).flatMap(([name, rawVersion]) => {
        const version = resolvedDependencyVersion(rawVersion);
        if (!version || version.startsWith('link:')) return [];
        const purl = packagePurl(name, version);
        return componentRefs.has(purl) ? [purl] : [];
      });
    },
  );
  return [...new Set(dependencies)].sort();
}

async function readBounded(
  path: string,
  maximumBytes: number,
): Promise<string> {
  const source = await readFile(path, 'utf8');
  if (Buffer.byteLength(source, 'utf8') > maximumBytes) {
    throw new RangeError(
      `${path} exceeds the ${maximumBytes} byte safety limit`,
    );
  }
  return source;
}

export async function generateSupplyChainInventory(
  options: GenerateSupplyChainInventoryOptions,
): Promise<SupplyChainInventory> {
  const projectRoot = resolve(options.projectRoot);
  const lockfilePath = resolve(
    options.lockfilePath ?? resolve(projectRoot, 'pnpm-lock.yaml'),
  );
  const [lockfileSource, packageSource] = await Promise.all([
    readBounded(lockfilePath, MAX_LOCKFILE_BYTES),
    readBounded(resolve(projectRoot, 'package.json'), 1_048_576),
  ]);
  const document = parseDocument(lockfileSource, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new TypeError(
      `pnpm lockfile YAML is invalid: ${document.errors.map((error) => error.message).join('; ')}`,
      { cause: document.errors[0] },
    );
  }
  const lockfile = document.toJS({ maxAliasCount: 25 }) as unknown;
  if (!isRecord(lockfile) || !isRecord(lockfile.packages)) {
    throw new TypeError('pnpm lockfile must contain a packages map');
  }
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(packageSource) as unknown;
  } catch (error) {
    throw new TypeError('Project package.json is invalid JSON', {
      cause: error,
    });
  }
  if (!isRecord(packageJson)) {
    throw new TypeError('Project package.json must contain an object');
  }

  const componentsByRef = new Map<string, CycloneDxComponent>();
  for (const [key, entry] of Object.entries(lockfile.packages)) {
    const parsed = parsePackageKey(key);
    if (!parsed) continue;
    const resolution = isRecord(entry) ? entry.resolution : undefined;
    const hashes = integrityHashes(resolution);
    componentsByRef.set(parsed.purl, {
      type: 'library',
      'bom-ref': parsed.purl,
      ...(parsed.group ? { group: parsed.group } : {}),
      name: parsed.name,
      version: parsed.version,
      purl: parsed.purl,
      ...(hashes ? { hashes } : {}),
    });
  }
  const components = [...componentsByRef.values()].sort((left, right) =>
    left.purl.localeCompare(right.purl),
  );
  const componentRefs = new Set(components.map((component) => component.purl));
  const rootName = readString(packageJson, 'name') ?? basename(projectRoot);
  const rootVersion = readString(packageJson, 'version') ?? '0.0.0';
  const rootPurl = packagePurl(rootName, rootVersion);
  const rootComponent: CycloneDxComponent = {
    type: 'application',
    'bom-ref': rootPurl,
    name: rootName,
    version: rootVersion,
    purl: rootPurl,
  };

  const dependencyMap = new Map<string, Set<string>>();
  const addDependency = (
    ref: string,
    dependencies: readonly string[],
  ): void => {
    const current = dependencyMap.get(ref) ?? new Set<string>();
    for (const dependency of dependencies) current.add(dependency);
    dependencyMap.set(ref, current);
  };
  const snapshots = isRecord(lockfile.snapshots) ? lockfile.snapshots : {};
  for (const [key, snapshot] of Object.entries(snapshots)) {
    const parsed = parsePackageKey(key);
    if (!parsed || !componentRefs.has(parsed.purl)) continue;
    addDependency(parsed.purl, dependenciesFrom(snapshot, componentRefs));
  }
  for (const component of components) addDependency(component.purl, []);
  const importers = isRecord(lockfile.importers) ? lockfile.importers : {};
  const rootImporter = importers['.'];
  addDependency(rootPurl, dependenciesFrom(rootImporter, componentRefs));

  const dependencies = [...dependencyMap.entries()]
    .map(([ref, values]) => ({ ref, dependsOn: [...values].sort() }))
    .sort((left, right) => left.ref.localeCompare(right.ref));
  const serialNumber = options.serialNumber ?? `urn:uuid:${randomUUID()}`;
  if (
    !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      serialNumber,
    )
  ) {
    throw new TypeError('CycloneDX serialNumber must be a urn:uuid value');
  }
  const bom: CycloneDxBom = {
    bomFormat: 'CycloneDX',
    specVersion: CYCLONEDX_SPEC_VERSION,
    serialNumber,
    version: 1,
    metadata: {
      timestamp: (options.now?.() ?? new Date()).toISOString(),
      component: rootComponent,
    },
    components,
    dependencies,
  };
  const sha256 = createHash('sha256').update(JSON.stringify(bom)).digest('hex');
  return {
    schemaVersion: '1.0',
    analyzer: 'pnpm-cyclonedx-inventory',
    lockfilePath,
    componentCount: components.length,
    sha256,
    bom,
    limitations: [
      'Inventory is derived from pnpm-lock.yaml and does not prove runtime reachability or exploitability',
    ],
  };
}

export async function writeSupplyChainInventory(
  outputPath: string,
  inventory: SupplyChainInventory,
): Promise<{ path: string; bytes: number; sha256: string }> {
  const path = resolve(outputPath);
  const content = `${JSON.stringify(inventory.bom, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  return {
    path,
    bytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

function osvEvidence(
  inventory: SupplyChainInventory,
  responseHashes: readonly string[],
): EvidenceReference {
  return {
    id: `osv-audit-${inventory.sha256.slice(0, 16)}`,
    kind: 'supply-chain-advisories',
    relation: 'supports',
    sha256: createHash('sha256')
      .update(`${inventory.sha256}:${responseHashes.join(':')}`)
      .digest('hex'),
  };
}

function auditFinding(
  outcome: AssuranceOutcome,
  evidence: EvidenceReference,
  advisories: readonly OsvAdvisoryReference[],
  limitations: readonly string[],
): AssuranceFinding {
  return AssuranceFindingSchema.parse({
    schemaVersion: '1.0',
    id: 'security.supply-chain.osv',
    ruleId: 'security.supply-chain.osv',
    title:
      outcome === 'FAIL'
        ? 'Known dependency advisories were found'
        : outcome === 'PASS'
          ? 'No known dependency advisories were returned'
          : 'Dependency advisory status was not verified',
    description:
      outcome === 'FAIL'
        ? `${advisories.length} package/advisory matches were returned by OSV.`
        : outcome === 'PASS'
          ? 'OSV returned no advisory matches for every queried locked dependency version.'
          : 'The complete locked dependency inventory could not be checked.',
    outcome,
    severity: outcome === 'FAIL' ? 'medium' : 'info',
    confidence: outcome === 'NOT_VERIFIED' ? 0 : 1,
    category: 'security',
    controls: ['MASVS-CODE-1'],
    evidence: [evidence],
    remediation:
      outcome === 'FAIL'
        ? 'Review each advisory, determine reachability and exploitability, then upgrade, patch, replace, or explicitly accept the risk.'
        : undefined,
    limitations: [...limitations],
  });
}

export async function auditOsvDependencies(
  options: AuditOsvDependenciesOptions,
): Promise<OsvDependencyAuditResult> {
  const endpoint = options.endpoint ?? OSV_QUERY_BATCH_ENDPOINT;
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== 'https:') {
    throw new TypeError('OSV endpoint must use HTTPS');
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 120_000
  ) {
    throw new RangeError('timeoutMs must be an integer from 1000 to 120000');
  }
  const maxComponents = options.maxComponents ?? MAX_OSV_COMPONENTS;
  if (
    !Number.isInteger(maxComponents) ||
    maxComponents < 1 ||
    maxComponents > MAX_OSV_COMPONENTS
  ) {
    throw new RangeError(
      `maxComponents must be from 1 to ${MAX_OSV_COMPONENTS}`,
    );
  }
  const components = options.inventory.bom.components.slice(0, maxComponents);
  const limitations: string[] = [];
  if (components.length < options.inventory.bom.components.length) {
    limitations.push(
      `Audit was bounded to ${components.length}/${options.inventory.bom.components.length} components`,
    );
  }
  const responseHashes: string[] = [];
  const advisories: OsvAdvisoryReference[] = [];
  let queriedComponents = 0;
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let offset = 0; offset < components.length; offset += OSV_BATCH_SIZE) {
      if (signal.aborted) {
        limitations.push('OSV audit was cancelled or timed out');
        break;
      }
      const batch = components.slice(offset, offset + OSV_BATCH_SIZE);
      await options.onProgress?.({
        completed: offset,
        total: components.length,
      });
      queriedComponents += batch.length;
      const response = await (options.fetchImpl ?? fetch)(endpointUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queries: batch.map((component) => ({
            package: { ecosystem: 'npm', name: component.name },
            version: component.version,
          })),
        }),
        signal,
      });
      if (!response.ok) {
        limitations.push(
          `OSV query failed with HTTP ${response.status} ${response.statusText}`.trim(),
        );
        break;
      }
      const source = await response.text();
      if (Buffer.byteLength(source, 'utf8') > MAX_OSV_RESPONSE_BYTES) {
        limitations.push('OSV response exceeded the 8 MiB safety limit');
        break;
      }
      responseHashes.push(createHash('sha256').update(source).digest('hex'));
      let body: unknown;
      try {
        body = JSON.parse(source) as unknown;
      } catch {
        limitations.push('OSV returned invalid JSON');
        break;
      }
      if (!isRecord(body) || !Array.isArray(body.results)) {
        limitations.push('OSV response did not contain a results array');
        break;
      }
      if (body.results.length !== batch.length) {
        limitations.push('OSV result count did not match the query batch');
      }
      for (const [index, rawResult] of body.results.entries()) {
        const component = batch[index];
        if (!component || !isRecord(rawResult)) continue;
        if (typeof rawResult.next_page_token === 'string') {
          limitations.push(
            `OSV pagination was required for ${component.name}@${component.version}`,
          );
        }
        const vulnerabilities = rawResult.vulns;
        if (!Array.isArray(vulnerabilities)) continue;
        for (const rawVulnerability of vulnerabilities) {
          if (!isRecord(rawVulnerability)) continue;
          const id = readString(rawVulnerability, 'id');
          if (!id) continue;
          const modified = readString(rawVulnerability, 'modified');
          advisories.push({
            id,
            ...(modified ? { modified } : {}),
            component: {
              name: component.name,
              version: component.version,
              purl: component.purl,
            },
          });
        }
      }
      await options.onProgress?.({
        completed: Math.min(offset + batch.length, components.length),
        total: components.length,
      });
    }
  } catch (error) {
    limitations.push(
      signal.aborted
        ? 'OSV audit was cancelled or timed out'
        : `OSV query failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
  const uniqueAdvisories = [
    ...new Map(
      advisories.map((advisory) => [
        `${advisory.component.purl}:${advisory.id}`,
        advisory,
      ]),
    ).values(),
  ].sort((left, right) =>
    `${left.component.purl}:${left.id}`.localeCompare(
      `${right.component.purl}:${right.id}`,
    ),
  );
  const evidence = osvEvidence(options.inventory, responseHashes);
  const outcome: AssuranceOutcome =
    uniqueAdvisories.length > 0
      ? 'FAIL'
      : limitations.length > 0
        ? 'NOT_VERIFIED'
        : 'PASS';
  const findingLimitations =
    outcome === 'NOT_VERIFIED'
      ? limitations
      : outcome === 'FAIL'
        ? [
            'Severity is conservatively reported as medium until each OSV record is enriched and triaged for reachability and exploitability',
            ...limitations,
          ]
        : [];
  const finding = auditFinding(
    outcome,
    evidence,
    uniqueAdvisories,
    findingLimitations,
  );
  return {
    schemaVersion: '1.0',
    analyzer: 'osv-dependency-audit',
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    endpoint: endpointUrl.toString(),
    outcome,
    queriedComponents,
    advisories: uniqueAdvisories,
    findings: [finding],
    evidence: [evidence],
    limitations,
  };
}
