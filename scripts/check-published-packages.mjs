/* global console, process */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifest = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
);
const expectedVersion = process.argv[2] ?? rootManifest.version;
const consumerPrefix = 'rn-agent-observer-registry-smoke-';
const packages = [
  '@rn-agent-observer/schemas',
  '@rn-agent-observer/core',
  '@rn-agent-observer/rn-instrumentation',
  '@rn-agent-observer/cli',
  '@rn-agent-observer/mcp-server',
];

function assert(condition, message) {
  if (!condition) throw new Error(`Published package check failed: ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(' ')} exited with ${String(result.status)}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return result.stdout.trim();
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function pnpm(args, cwd = repositoryRoot) {
  const executable = process.env.npm_execpath;
  if (executable) {
    return run(process.execPath, [executable, ...args], { cwd });
  }
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    cwd,
  });
}

function childPath(parent, candidate) {
  const relation = relative(parent, candidate);
  return (
    relation.length > 0 &&
    !isAbsolute(relation) &&
    relation !== '..' &&
    !relation.startsWith(`..${sep}`)
  );
}

function cleanupConsumer(directory) {
  if (!existsSync(directory)) return;
  const temporaryRoot = realpathSync(tmpdir());
  const resolvedDirectory = realpathSync(directory);
  assert(
    basename(resolvedDirectory).startsWith(consumerPrefix) &&
      childPath(temporaryRoot, resolvedDirectory),
    `refusing to remove unexpected path ${resolvedDirectory}`,
  );
  rmSync(resolvedDirectory, { recursive: true, force: true });
}

async function waitForRegistry(packageName) {
  let lastError = null;
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    try {
      const metadata = JSON.parse(
        run(npmCommand, [
          'view',
          `${packageName}@${expectedVersion}`,
          'name',
          'version',
          'dist.integrity',
          'dist.tarball',
          '--json',
        ]),
      );
      assert(
        metadata.name === packageName,
        `${packageName} returned wrong name`,
      );
      assert(
        metadata.version === expectedVersion,
        `${packageName} returned version ${String(metadata.version)}`,
      );
      assert(
        typeof metadata['dist.integrity'] === 'string' &&
          metadata['dist.integrity'].startsWith('sha512-'),
        `${packageName} is missing sha512 integrity`,
      );
      assert(
        typeof metadata['dist.tarball'] === 'string' &&
          metadata['dist.tarball'].startsWith('https://registry.npmjs.org/'),
        `${packageName} returned an unexpected tarball URL`,
      );
      return metadata;
    } catch (error) {
      lastError = error;
      if (attempt < 18) await delay(5_000);
    }
  }
  throw lastError;
}

assert(
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedVersion),
  `invalid expected version ${expectedVersion}`,
);

const registryMetadata = [];
for (const packageName of packages) {
  registryMetadata.push(await waitForRegistry(packageName));
}

const consumerDirectory = mkdtempSync(resolve(tmpdir(), consumerPrefix));
try {
  writeFileSync(
    resolve(consumerDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'rn-agent-observer-public-registry-smoke',
        private: true,
        packageManager: rootManifest.packageManager,
        devDependencies: Object.fromEntries(
          packages.map((packageName) => [packageName, `${expectedVersion}`]),
        ),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  pnpm(['install', '--frozen-lockfile=false'], consumerDirectory);
  assert(
    pnpm(['exec', 'rn-observe', '--version'], consumerDirectory) ===
      expectedVersion,
    'installed CLI version does not match the registry release',
  );
  pnpm(['exec', 'rn-observer-mcp', '--check'], consumerDirectory);
  console.log(
    JSON.stringify(
      {
        outcome: 'PASS',
        version: expectedVersion,
        packages: registryMetadata.map((metadata) => ({
          name: metadata.name,
          version: metadata.version,
          integrity: metadata['dist.integrity'],
          tarball: metadata['dist.tarball'],
        })),
        consumer: {
          cliVersion: expectedVersion,
          mcpCheck: 'PASS',
        },
      },
      null,
      2,
    ),
  );
} finally {
  cleanupConsumer(consumerDirectory);
}
