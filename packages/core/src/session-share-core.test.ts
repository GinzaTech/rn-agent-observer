import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultObserverConfig } from './config/observer-config.js';
import { ObserverCore, ObserverError } from './index.js';

interface TestCore {
  core: ObserverCore;
  root: string;
}

const testCores: TestCore[] = [];

function createCore(allowShare: boolean): TestCore {
  const root = mkdtempSync(join(tmpdir(), 'rn-observer-session-share-core-'));
  const config = defaultObserverConfig();
  config.artifacts.allowShare = allowShare;
  writeFileSync(
    join(root, '.rn-observer.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );
  const testCore = {
    core: new ObserverCore({
      projectRoot: root,
      captureRuntimeUiOnStop: false,
      onWarning: () => {},
    }),
    root,
  };
  testCores.push(testCore);
  return testCore;
}

function errorCode(action: () => void): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ObserverError);
    return (error as ObserverError).code;
  }
  throw new Error('Expected action to throw');
}

afterEach(() => {
  for (const { core, root } of testCores.splice(0)) {
    core.close();
    rmSync(root, { recursive: true, force: true });
  }
});

describe('ObserverCore session share bundles', () => {
  it('requires explicit project-level sharing consent', () => {
    const { core } = createCore(false);
    const session = core.startSession();

    expect(errorCode(() => core.exportSessionShareBundle(session.id))).toBe(
      'SHARING_DISABLED',
    );
  });

  it('writes and verifies a .rnobs bundle only inside the artifact root', () => {
    const { core, root } = createCore(true);
    const session = core.startSession();
    const relativePath = 'shares/community-session.rnobs';

    const exported = core.exportSessionShareBundle(session.id, {
      relativePath,
    });
    const expectedPath = join(
      root,
      '.artifacts',
      'shares',
      'community-session.rnobs',
    );

    expect(exported.bundle.path).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(exported.bundle.path).toContain(resolve(root, '.artifacts'));
    expect(exported.artifact).toMatchObject({
      kind: 'share-bundle',
      path: expectedPath,
      mimeType:
        'application/vnd.rn-agent-observer.session-evidence-bundle+json',
    });
    expect(
      core
        .getSession(session.id)
        .artifacts.some(
          (artifact) =>
            artifact.id === exported.artifact.id &&
            artifact.kind === 'share-bundle',
        ),
    ).toBe(true);

    expect(
      core.verifySessionShareBundle(relativePath, exported.bundle.sha256),
    ).toMatchObject({
      valid: true,
      sha256: exported.bundle.sha256,
      sessionId: session.id,
    });
  });

  it('rejects traversal and absolute bundle paths before they can write outside artifacts', () => {
    const { core, root } = createCore(true);
    const session = core.startSession();
    const outsidePath = join(root, 'outside.rnobs');

    expect(
      errorCode(() =>
        core.exportSessionShareBundle(session.id, {
          relativePath: '../outside.rnobs',
        }),
      ),
    ).toBe('ARTIFACT_PATH_INVALID');
    expect(
      errorCode(() =>
        core.exportSessionShareBundle(session.id, {
          relativePath: outsidePath,
        }),
      ),
    ).toBe('ARTIFACT_PATH_INVALID');
    expect(
      errorCode(() => core.verifySessionShareBundle('../outside.rnobs')),
    ).toBe('ARTIFACT_PATH_INVALID');
    expect(errorCode(() => core.verifySessionShareBundle(outsidePath))).toBe(
      'ARTIFACT_PATH_INVALID',
    );
    expect(existsSync(outsidePath)).toBe(false);
  });
});
