import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { Artifact, Session } from '@rn-agent-observer/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import {
  exportSessionShareBundle,
  isSafeBundleEntryName,
  readAndVerifySessionShareBundle,
  SessionShareBundleError,
  type SessionShareBundleEnvelope,
  verifySessionShareBundle,
} from './share-bundle.js';

const FIXED_NOW = '2026-08-22T01:02:03.000Z';
const STARTED_AT = '2026-08-22T00:00:00.000Z';
const STOPPED_AT = '2026-08-22T00:01:00.000Z';
const ARTIFACT_CREATED_AT = '2026-08-22T00:00:30.000Z';
const temporaryDirectories: string[] = [];

interface TestWorkspace {
  readonly base: string;
  readonly artifactRoot: string;
}

function workspace(): TestWorkspace {
  const base = mkdtempSync(join(tmpdir(), 'rnobs-share-bundle-'));
  const artifactRoot = join(base, 'artifacts');
  mkdirSync(artifactRoot);
  temporaryDirectories.push(base);
  return { base, artifactRoot };
}

function artifact(
  id: string,
  path: string,
  options: {
    readonly kind?: Artifact['kind'];
    readonly mimeType?: string;
  } = {},
): Artifact {
  return {
    id,
    kind: options.kind ?? 'log',
    path,
    ...(options.mimeType === undefined ? {} : { mimeType: options.mimeType }),
    createdAt: ARTIFACT_CREATED_AT,
  };
}

function session(artifacts: readonly Artifact[]): Session {
  return {
    schemaVersion: '1.0',
    id: 'session-portable-1',
    projectRoot: 'C:\\private\\absolute\\project-root',
    startedAt: STARTED_AT,
    stoppedAt: STOPPED_AT,
    status: 'complete',
    artifactIds: artifacts.map(({ id }) => id),
    artifacts: [...artifacts],
    timeline: [
      {
        schemaVersion: '1.0',
        id: 1,
        type: 'sensitive-event',
        timestamp: STARTED_AT,
        data: { projectRoot: '/private/timeline/project-root' },
      },
    ],
  };
}

function parseBundle(path: string): SessionShareBundleEnvelope {
  return JSON.parse(readFileSync(path, 'utf8')) as SessionShareBundleEnvelope;
}

function canonical(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function bundleError(callback: () => void, code: string): void {
  let caught: unknown;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SessionShareBundleError);
  expect((caught as SessionShareBundleError).code).toBe(code);
}

function createDirectoryLink(target: string, path: string): boolean {
  try {
    symlinkSync(
      target,
      path,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    return true;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { readonly code?: unknown }).code
        : undefined;
    if (code === 'EPERM' || code === 'EACCES') return false;
    throw error;
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('portable session evidence bundle', () => {
  it('creates deterministic metadata-only bundles without absolute paths or binary content', () => {
    const { base, artifactRoot } = workspace();
    const textPath = join(artifactRoot, 'nested', 'events.json');
    const binaryPath = join(artifactRoot, 'screen.png');
    mkdirSync(join(artifactRoot, 'nested'));
    const text = '{"event":"safe"}\n';
    const binary = Buffer.from([0, 1, 2, 3, 252, 253, 254, 255]);
    writeFileSync(textPath, text);
    writeFileSync(binaryPath, binary);
    const source = session([
      artifact('text-1', textPath, {
        kind: 'summary',
        mimeType: 'application/json',
      }),
      artifact('binary-1', binaryPath, {
        kind: 'screenshot',
        mimeType: 'image/png',
      }),
    ]);
    const firstPath = join(base, 'first.rnobs');
    const secondPath = join(base, 'second.rnobs');

    const first = exportSessionShareBundle(source, {
      artifactRoot,
      outputPath: firstPath,
      now: () => FIXED_NOW,
    });
    const second = exportSessionShareBundle(source, {
      artifactRoot,
      outputPath: secondPath,
      now: () => FIXED_NOW,
    });

    const firstBytes = readFileSync(firstPath);
    expect(first.outcome).toBe('PASS');
    expect(first.metadataOnlyCount).toBe(2);
    expect(first.embeddedTextCount).toBe(0);
    expect(first.sha256).toBe(second.sha256);
    expect(firstBytes.equals(readFileSync(secondPath))).toBe(true);
    expect(firstBytes.toString('utf8')).not.toContain(source.projectRoot);
    expect(firstBytes.toString('utf8')).not.toContain(textPath);
    expect(firstBytes.toString('utf8')).not.toContain(binaryPath);
    expect(firstBytes.toString('utf8')).not.toContain(
      '/private/timeline/project-root',
    );
    expect(firstBytes.toString('utf8')).not.toContain(
      binary.toString('base64'),
    );

    const envelope = parseBundle(firstPath);
    expect(envelope.createdAt).toBe(FIXED_NOW);
    expect(envelope.session).toEqual({
      id: source.id,
      startedAt: STARTED_AT,
      stoppedAt: STOPPED_AT,
      status: 'complete',
      eventCount: 1,
      artifactCount: 2,
    });
    expect(
      envelope.entries.every(({ name }) => isSafeBundleEntryName(name)),
    ).toBe(true);
    expect(isSafeBundleEntryName('../escape.txt')).toBe(false);
    expect(isSafeBundleEntryName('C:portable.txt')).toBe(false);
    expect(isSafeBundleEntryName('a/unsafe name.txt')).toBe(false);
    expect(envelope.entries.every(({ sha256 }) => sha256 !== null)).toBe(true);
    expect(envelope.entries.every((entry) => !('content' in entry))).toBe(true);

    const verified = verifySessionShareBundle(firstBytes, {
      expectedSha256: first.sha256,
    });
    expect(verified).toMatchObject({
      valid: true,
      sessionId: source.id,
      entryCount: 2,
      metadataOnlyCount: 2,
    });
    if (process.platform !== 'win32') {
      expect(statSync(firstPath).mode & 0o777).toBe(0o600);
    }
  });

  it('omits deep-link timeline values from default exported evidence', () => {
    const { base, artifactRoot } = workspace();
    const raw =
      'demo://alice:correct-horse@store.example/products/42?token=private-token#private-fragment';
    const source: Session = {
      ...session([]),
      timeline: [
        {
          schemaVersion: '1.0',
          id: 1,
          type: 'deep_link',
          timestamp: STARTED_AT,
          data: { uri: raw },
        },
      ],
    };
    const outputPath = join(base, 'default-evidence.rnobs');

    const result = exportSessionShareBundle(source, {
      artifactRoot,
      outputPath,
      now: () => FIXED_NOW,
    });
    const output = readFileSync(outputPath, 'utf8');

    expect(result.embeddedTextCount).toBe(0);
    expect(output).not.toContain('alice');
    expect(output).not.toContain('correct-horse');
    expect(output).not.toContain('private-token');
    expect(output).not.toContain('private-fragment');
  });

  it('never overwrites or removes an existing output file', () => {
    const { base, artifactRoot } = workspace();
    const textPath = join(artifactRoot, 'events.log');
    const outputPath = join(base, 'existing.rnobs');
    writeFileSync(textPath, 'safe event\n');
    writeFileSync(outputPath, 'sentinel-do-not-touch');

    bundleError(
      () =>
        exportSessionShareBundle(session([artifact('log-1', textPath)]), {
          artifactRoot,
          outputPath,
          now: () => FIXED_NOW,
        }),
      'BUNDLE_OUTPUT_EXISTS',
    );
    expect(readFileSync(outputPath, 'utf8')).toBe('sentinel-do-not-touch');
  });

  it('embeds only explicitly requested text that completes secret scanning', () => {
    const { base, artifactRoot } = workspace();
    const cleanPath = join(artifactRoot, 'clean.txt');
    const secretPath = join(artifactRoot, 'secret.txt');
    const largePath = join(artifactRoot, 'large.txt');
    const cleanText = 'observer result: safe\n';
    const secret = 'super-secret-value';
    writeFileSync(cleanPath, cleanText);
    writeFileSync(secretPath, `password=${secret}\n`);
    writeFileSync(largePath, 'x'.repeat(64));

    const cleanOutput = join(base, 'clean.rnobs');
    const cleanResult = exportSessionShareBundle(
      session([
        artifact('clean-1', cleanPath, {
          mimeType: 'text/plain',
        }),
      ]),
      {
        artifactRoot,
        outputPath: cleanOutput,
        includeTextArtifacts: true,
        now: () => FIXED_NOW,
      },
    );
    expect(cleanResult.outcome).toBe('PASS');
    expect(parseBundle(cleanOutput).entries[0]).toMatchObject({
      inclusion: 'embedded-text',
      verification: 'VERIFIED',
      content: cleanText,
    });
    expect(verifySessionShareBundle(readFileSync(cleanOutput)).valid).toBe(
      true,
    );

    const secretOutput = join(base, 'secret.rnobs');
    const secretResult = exportSessionShareBundle(
      session([
        artifact('secret-1', secretPath, {
          mimeType: 'text/plain',
        }),
      ]),
      {
        artifactRoot,
        outputPath: secretOutput,
        includeTextArtifacts: true,
        now: () => FIXED_NOW,
      },
    );
    expect(secretResult.outcome).toBe('NOT_VERIFIED');
    expect(parseBundle(secretOutput).entries[0]).toMatchObject({
      inclusion: 'metadata-only',
      verification: 'NOT_VERIFIED',
      reason: 'SECRET_DETECTED',
    });
    expect(readFileSync(secretOutput, 'utf8')).not.toContain(secret);
    expect(parseBundle(secretOutput).entries[0]).not.toHaveProperty('content');

    const largeOutput = join(base, 'large.rnobs');
    const largeResult = exportSessionShareBundle(
      session([
        artifact('large-1', largePath, {
          mimeType: 'text/plain',
        }),
      ]),
      {
        artifactRoot,
        outputPath: largeOutput,
        includeTextArtifacts: true,
        limits: { maxEmbeddedTextBytes: 32 },
        now: () => FIXED_NOW,
      },
    );
    expect(largeResult.outcome).toBe('NOT_VERIFIED');
    expect(parseBundle(largeOutput).entries[0]).toMatchObject({
      inclusion: 'metadata-only',
      verification: 'NOT_VERIFIED',
      reason: 'SECRET_SCAN_INCOMPLETE',
    });
    expect(parseBundle(largeOutput).entries[0]).not.toHaveProperty('content');
    expect(readFileSync(largeOutput, 'utf8')).not.toContain('x'.repeat(64));
  });

  it('never embeds base64 payloads and makes a forged encoded entry invalid', () => {
    const { base, artifactRoot } = workspace();
    const encodedPath = join(artifactRoot, 'encoded.txt');
    const encoded = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]).toString('base64');
    writeFileSync(encodedPath, `${encoded}\n`);
    const outputPath = join(base, 'encoded.rnobs');

    const result = exportSessionShareBundle(
      session([artifact('encoded-1', encodedPath, { mimeType: 'text/plain' })]),
      {
        artifactRoot,
        outputPath,
        includeTextArtifacts: true,
        now: () => FIXED_NOW,
      },
    );

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(parseBundle(outputPath).entries[0]).toMatchObject({
      inclusion: 'metadata-only',
      verification: 'NOT_VERIFIED',
      reason: 'BASE64_PAYLOAD_DETECTED',
    });
    expect(readFileSync(outputPath, 'utf8')).not.toContain(encoded);

    const cleanPath = join(artifactRoot, 'clean-forged.txt');
    const cleanOutput = join(base, 'clean-forged.rnobs');
    writeFileSync(cleanPath, 'safe evidence\n');
    exportSessionShareBundle(
      session([
        artifact('clean-forged-1', cleanPath, { mimeType: 'text/plain' }),
      ]),
      {
        artifactRoot,
        outputPath: cleanOutput,
        includeTextArtifacts: true,
        now: () => FIXED_NOW,
      },
    );
    const forged = parseBundle(cleanOutput) as {
      entries: Array<{ bytes: number; content: string; sha256: string }>;
    };
    forged.entries[0]!.content = encoded;
    forged.entries[0]!.bytes = Buffer.byteLength(encoded, 'utf8');
    forged.entries[0]!.sha256 = createHash('sha256')
      .update(encoded)
      .digest('hex');
    bundleError(
      () => verifySessionShareBundle(canonical(forged)),
      'BUNDLE_EMBEDDED_TEXT_UNSAFE',
    );
  });

  it('excludes traversal, missing files, and symlink path components without reading them', () => {
    const { base, artifactRoot } = workspace();
    const outsideDirectory = join(base, 'outside');
    const outsidePath = join(outsideDirectory, 'secret.log');
    const outsideSecret = 'outside-content-must-not-be-read';
    mkdirSync(outsideDirectory);
    writeFileSync(outsidePath, outsideSecret);
    const linkedDirectory = join(artifactRoot, 'linked');
    const linkAvailable = createDirectoryLink(
      outsideDirectory,
      linkedDirectory,
    );
    const artifacts = [
      artifact('absolute-escape', outsidePath),
      artifact('relative-escape', join('..', 'outside', 'secret.log')),
      artifact('missing', join(artifactRoot, 'missing.log')),
      ...(linkAvailable
        ? [artifact('symlink', join(linkedDirectory, 'secret.log'))]
        : []),
    ];
    const outputPath = join(base, 'excluded.rnobs');

    const result = exportSessionShareBundle(session(artifacts), {
      artifactRoot,
      outputPath,
      includeTextArtifacts: true,
      now: () => FIXED_NOW,
    });

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.excludedCount).toBe(artifacts.length);
    const envelope = parseBundle(outputPath);
    expect(
      envelope.entries.every((entry) => entry.inclusion === 'excluded'),
    ).toBe(true);
    expect(envelope.entries.every((entry) => entry.sha256 === null)).toBe(true);
    expect(envelope.entries.map(({ reason }) => reason)).toEqual(
      expect.arrayContaining([
        'ARTIFACT_PATH_ESCAPE',
        'ARTIFACT_MISSING_OR_UNREADABLE',
        ...(linkAvailable ? ['ARTIFACT_SYMLINK_EXCLUDED'] : []),
      ]),
    );
    expect(readFileSync(outputPath, 'utf8')).not.toContain(outsideSecret);
  });

  it('enforces entry, count, total bundle, and reader limits', () => {
    const { base, artifactRoot } = workspace();
    const largePath = join(artifactRoot, 'a-large.log');
    const smallPath = join(artifactRoot, 'b-small.log');
    writeFileSync(largePath, 'L'.repeat(128));
    writeFileSync(smallPath, 'small');
    const outputPath = join(base, 'limited.rnobs');
    const result = exportSessionShareBundle(
      session([artifact('a-large', largePath), artifact('b-small', smallPath)]),
      {
        artifactRoot,
        outputPath,
        limits: { maxEntries: 1, maxEntryBytes: 32 },
        now: () => FIXED_NOW,
      },
    );

    expect(result).toMatchObject({
      outcome: 'NOT_VERIFIED',
      entryCount: 1,
      excludedCount: 1,
      omittedArtifactCount: 1,
    });
    expect(parseBundle(outputPath).entries[0]).toMatchObject({
      inclusion: 'excluded',
      reason: 'ARTIFACT_ENTRY_LIMIT',
      bytes: null,
      sha256: null,
    });
    bundleError(
      () =>
        verifySessionShareBundle(readFileSync(outputPath), {
          limits: { maxBundleBytes: 64 },
        }),
      'BUNDLE_SIZE_LIMIT',
    );
    bundleError(
      () =>
        readAndVerifySessionShareBundle(outputPath, {
          limits: { maxBundleBytes: 64 },
        }),
      'BUNDLE_SIZE_LIMIT',
    );
  });

  it('detects whole-file, per-entry, traversal, and declared-policy tampering', () => {
    const { base, artifactRoot } = workspace();
    const textPath = join(artifactRoot, 'result.txt');
    const outputPath = join(base, 'original.rnobs');
    writeFileSync(textPath, 'safe-result\n');
    const exported = exportSessionShareBundle(
      session([
        artifact('result-1', textPath, {
          mimeType: 'text/plain',
        }),
      ]),
      {
        artifactRoot,
        outputPath,
        includeTextArtifacts: true,
        now: () => FIXED_NOW,
      },
    );
    const original = readFileSync(outputPath);
    const contentTamper = parseBundle(outputPath) as {
      entries: Array<{ content?: string }>;
    };
    contentTamper.entries[0]!.content = 'evil-result\n';
    const tamperedContentBytes = canonical(contentTamper);
    bundleError(
      () =>
        verifySessionShareBundle(tamperedContentBytes, {
          expectedSha256: exported.sha256,
        }),
      'BUNDLE_HASH_MISMATCH',
    );
    bundleError(
      () => verifySessionShareBundle(tamperedContentBytes),
      'BUNDLE_ENTRY_HASH_MISMATCH',
    );

    const pathTamper = parseBundle(outputPath) as {
      entries: Array<{ name: string }>;
    };
    pathTamper.entries[0]!.name = '../escape.txt';
    bundleError(
      () => verifySessionShareBundle(canonical(pathTamper)),
      'BUNDLE_ENTRY_NAME_UNSAFE',
    );

    const policyTamper = parseBundle(outputPath) as {
      policy: { textEmbedding: string };
    };
    policyTamper.policy.textEmbedding = 'disabled';
    bundleError(
      () => verifySessionShareBundle(canonical(policyTamper)),
      'BUNDLE_POLICY_INCONSISTENT',
    );
    expect(verifySessionShareBundle(original).valid).toBe(true);
  });

  it('reads and verifies without extraction or filesystem writes and rejects input symlinks', () => {
    const { base, artifactRoot } = workspace();
    const textPath = join(artifactRoot, 'result.log');
    const outputPath = join(base, 'portable.rnobs');
    writeFileSync(textPath, 'safe log\n');
    const exported = exportSessionShareBundle(
      session([artifact('result-1', textPath)]),
      {
        artifactRoot,
        outputPath,
        now: () => FIXED_NOW,
      },
    );
    const before = readdirSync(base).sort();

    const verified = readAndVerifySessionShareBundle(outputPath, {
      expectedSha256: exported.sha256,
    });

    expect(verified.valid).toBe(true);
    expect(verified).not.toHaveProperty('entries');
    expect(readdirSync(base).sort()).toEqual(before);
    const linkPath = join(base, 'portable-link.rnobs');
    let linked = true;
    try {
      symlinkSync(
        relative(base, outputPath),
        linkPath,
        process.platform === 'win32' ? 'file' : undefined,
      );
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { readonly code?: unknown }).code
          : undefined;
      if (code === 'EPERM' || code === 'EACCES') linked = false;
      else throw error;
    }
    if (linked) {
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      bundleError(
        () => readAndVerifySessionShareBundle(linkPath),
        'BUNDLE_INPUT_UNSAFE',
      );
    }
  });
});
