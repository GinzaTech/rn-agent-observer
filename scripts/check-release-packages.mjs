/* global console, process */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packDirectory = resolve(repositoryRoot, '.artifacts', 'package-smoke');
const repositoryUrl = 'git+https://github.com/GinzaTech/rn-agent-observer.git';
const issuesUrl = 'https://github.com/GinzaTech/rn-agent-observer/issues';
const consumerProjectPrefix = 'rn-agent-observer-consumer-smoke-';
const lockfile = readFileSync(
  resolve(repositoryRoot, 'pnpm-lock.yaml'),
  'utf8',
);

assert(
  !/^\s{2}(?:metro|metro-[^@]+)@0\.84\.4:/mu.test(lockfile),
  'Lockfile still contains a Metro 0.84.4 package; the pnpm hook did not enforce the security patch',
);
assert(
  !/^\s{2}uuid@7\.0\.3:/mu.test(lockfile),
  'Lockfile still contains uuid 7.0.3; the pnpm hook did not enforce the compatibility override',
);

const packages = [
  {
    directory: 'packages/schemas',
    entries: ['dist/index.js', 'dist/index.d.ts'],
  },
  {
    directory: 'packages/core',
    entries: ['dist/index.js', 'dist/index.d.ts'],
  },
  {
    directory: 'packages/rn-instrumentation',
    entries: ['dist/index.js', 'dist/index.d.ts', 'babel-plugin.cjs'],
  },
  {
    directory: 'packages/cli',
    entries: ['dist/index.js', 'dist/index.d.ts'],
  },
  {
    directory: 'packages/mcp-server',
    entries: ['dist/server.js', 'dist/server.d.ts'],
  },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function packageArchiveName(name, version) {
  return `${name.replace(/^@/, '').replaceAll('/', '-')}-${version}.tgz`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(' ')} exited with ${result.status ?? 'no status'}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return result.stdout;
}

function runPnpm(args, cwd, options = {}) {
  const pnpmExecutable = process.env.npm_execpath;
  if (pnpmExecutable) {
    return run(process.execPath, [pnpmExecutable, ...args], {
      cwd,
      ...options,
    });
  }
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    cwd,
    ...options,
  });
}

function isChildPath(parent, candidate) {
  const relation = relative(parent, candidate);
  return (
    relation.length > 0 &&
    !isAbsolute(relation) &&
    relation !== '..' &&
    !relation.startsWith(`..${sep}`)
  );
}

function cleanTemporaryConsumerProject(consumerDirectory) {
  if (!existsSync(consumerDirectory)) return;
  const temporaryRoot = realpathSync(tmpdir());
  const resolvedConsumerDirectory = realpathSync(consumerDirectory);
  assert(
    basename(resolvedConsumerDirectory).startsWith(consumerProjectPrefix) &&
      isChildPath(temporaryRoot, resolvedConsumerDirectory),
    `Refusing to remove an unsafe consumer smoke directory: ${resolvedConsumerDirectory}`,
  );
  rmSync(resolvedConsumerDirectory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}

function consumerEnvironment(consumerDirectory) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.toUpperCase().startsWith('RN_OBSERVER_'),
    ),
  );
  environment.RN_OBSERVER_PROJECT_ROOT = consumerDirectory;
  return environment;
}

function runConsumerInstallSmoke(rootManifest, archivesByPackage) {
  const consumerPackages = [
    '@rn-agent-observer/schemas',
    '@rn-agent-observer/core',
    '@rn-agent-observer/cli',
    '@rn-agent-observer/mcp-server',
  ];
  const archivePaths = consumerPackages.map((packageName) => {
    const archivePath = archivesByPackage.get(packageName);
    assert(archivePath, `Missing local tarball for ${packageName}`);
    return archivePath;
  });
  const consumerDirectory = mkdtempSync(
    resolve(tmpdir(), consumerProjectPrefix),
  );
  const localArchives = Object.fromEntries(
    consumerPackages.map((packageName, index) => [
      packageName,
      `file:${relative(consumerDirectory, archivePaths[index]).replaceAll('\\', '/')}`,
    ]),
  );
  const environment = consumerEnvironment(consumerDirectory);
  let smokeError = null;
  let cleanupError = null;

  try {
    writeFileSync(
      resolve(consumerDirectory, 'package.json'),
      `${JSON.stringify(
        {
          name: 'rn-agent-observer-release-consumer-smoke',
          private: true,
          packageManager: rootManifest.packageManager,
          devDependencies: localArchives,
          pnpm: {
            // Published packages depend on exact internal versions. Pin their
            // transitive requests to these local tarballs so this test cannot
            // accidentally pass by resolving a package from the npm registry.
            overrides: localArchives,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    runPnpm(['install'], consumerDirectory, { env: environment });

    const consumerManifest = readJson(
      resolve(consumerDirectory, 'package.json'),
    );
    for (const packageName of consumerPackages) {
      const requested = consumerManifest.devDependencies?.[packageName];
      assert(
        typeof requested === 'string' && requested.startsWith('file:'),
        `Consumer smoke did not install ${packageName} from its local tarball`,
      );
      const installedManifest = readJson(
        resolve(consumerDirectory, 'node_modules', packageName, 'package.json'),
      );
      assert(
        installedManifest.version === rootManifest.version,
        `Consumer smoke installed ${packageName}@${installedManifest.version}; expected ${rootManifest.version}`,
      );
    }

    const version = runPnpm(
      ['exec', 'rn-observe', '--version'],
      consumerDirectory,
      { env: environment },
    ).trim();
    assert(
      version === rootManifest.version,
      `Consumer CLI reported ${version}; expected ${rootManifest.version}`,
    );
    const help = runPnpm(['exec', 'rn-observe', '--help'], consumerDirectory, {
      env: environment,
    });
    assert(
      help.includes('rn-observe init [--dry-run]'),
      'Consumer CLI help is incomplete',
    );
    const init = JSON.parse(
      runPnpm(['exec', 'rn-observe', 'init', '--dry-run'], consumerDirectory, {
        env: environment,
      }),
    );
    assert(
      init.dryRun === true && init.created === false,
      'Consumer CLI init --dry-run did not report a dry run',
    );
    assert(
      !existsSync(resolve(consumerDirectory, '.rn-observer.json')),
      'Consumer CLI init --dry-run wrote .rn-observer.json',
    );
    runPnpm(['exec', 'rn-observer-mcp', '--check'], consumerDirectory, {
      env: environment,
    });

    console.log(
      'consumer smoke: installed local CLI/MCP tarballs and ran CLI plus MCP health checks',
    );
  } catch (error) {
    smokeError = error;
  }
  try {
    cleanTemporaryConsumerProject(consumerDirectory);
  } catch (error) {
    cleanupError = error;
  }
  if (smokeError) {
    if (cleanupError) {
      console.error(
        `consumer smoke cleanup failed: ${
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError)
        }`,
      );
    }
    throw smokeError;
  }
  if (cleanupError) {
    throw cleanupError;
  }
}

const rootManifest = readJson(resolve(repositoryRoot, 'package.json'));
const demoManifest = readJson(
  resolve(repositoryRoot, 'apps', 'demo-expo', 'package.json'),
);

assert(rootManifest.private === true, 'The workspace root must remain private');
assert(demoManifest.private === true, 'The demo app must remain private');
assert(
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
    rootManifest.version,
  ),
  `Root version is not valid semver: ${rootManifest.version}`,
);

mkdirSync(packDirectory, { recursive: true });
const archivesByPackage = new Map();

for (const packageSpec of packages) {
  const packageDirectory = resolve(repositoryRoot, packageSpec.directory);
  const sourceManifest = readJson(resolve(packageDirectory, 'package.json'));
  const label = sourceManifest.name ?? packageSpec.directory;

  assert(
    typeof sourceManifest.name === 'string' &&
      sourceManifest.name.startsWith('@rn-agent-observer/'),
    `${packageSpec.directory} has an invalid package name`,
  );
  assert(sourceManifest.private !== true, `${label} is still private`);
  assert(
    sourceManifest.version === rootManifest.version,
    `${label} version ${sourceManifest.version} does not match root ${rootManifest.version}`,
  );
  assert(
    sourceManifest.license === 'Apache-2.0',
    `${label} license is not Apache-2.0`,
  );
  assert(
    sourceManifest.repository?.url === repositoryUrl &&
      sourceManifest.repository?.directory === packageSpec.directory,
    `${label} repository metadata is missing or incorrect`,
  );
  assert(
    sourceManifest.homepage?.startsWith(
      'https://github.com/GinzaTech/rn-agent-observer/',
    ),
    `${label} homepage is missing or incorrect`,
  );
  assert(
    sourceManifest.bugs?.url === issuesUrl,
    `${label} bugs URL is missing or incorrect`,
  );
  assert(
    sourceManifest.publishConfig?.access === 'public' &&
      sourceManifest.publishConfig?.registry ===
        'https://registry.npmjs.org/' &&
      sourceManifest.publishConfig?.provenance === true,
    `${label} must publish publicly to npm with provenance`,
  );
  assert(
    typeof sourceManifest.description === 'string' &&
      sourceManifest.description.length > 20,
    `${label} needs a useful description`,
  );

  for (const entry of packageSpec.entries) {
    assert(
      existsSync(resolve(packageDirectory, entry)),
      `${label} is missing ${entry}; run pnpm build before pack:check`,
    );
  }

  for (const [dependency, range] of Object.entries(
    sourceManifest.dependencies ?? {},
  )) {
    if (dependency.startsWith('@rn-agent-observer/')) {
      assert(
        range === 'workspace:*',
        `${label} must keep ${dependency} as workspace:* in source`,
      );
    }
  }

  runPnpm(['pack', '--pack-destination', packDirectory], packageDirectory);
  const archivePath = resolve(
    packDirectory,
    packageArchiveName(sourceManifest.name, sourceManifest.version),
  );
  assert(existsSync(archivePath), `${label} did not produce ${archivePath}`);
  archivesByPackage.set(sourceManifest.name, archivePath);

  const entries = run('tar', ['-tf', archivePath])
    .split(/\r?\n/u)
    .filter(Boolean);
  for (const entry of [
    'package/package.json',
    'package/README.md',
    'package/LICENSE',
    ...packageSpec.entries.map((path) => `package/${path}`),
  ]) {
    assert(entries.includes(entry), `${label} tarball is missing ${entry}`);
  }
  assert(
    !entries.some(
      (entry) =>
        entry.includes('/src/') ||
        entry.includes('/.artifacts/') ||
        /\.test\.(?:js|d\.ts)$/u.test(entry),
    ),
    `${label} tarball contains source, runtime artifacts, or compiled tests`,
  );

  const packedManifest = JSON.parse(
    run('tar', ['-xOf', archivePath, 'package/package.json']),
  );
  assert(packedManifest.private !== true, `${label} packed as private`);
  for (const [dependency, range] of Object.entries(
    packedManifest.dependencies ?? {},
  )) {
    if (dependency.startsWith('@rn-agent-observer/')) {
      assert(
        range === rootManifest.version,
        `${label} packed ${dependency} as ${range}; expected ${rootManifest.version}`,
      );
    }
  }

  console.log(
    `package smoke: ${label}@${sourceManifest.version} -> ${relative(repositoryRoot, archivePath)}`,
  );
}

runConsumerInstallSmoke(rootManifest, archivesByPackage);

console.log(`Validated ${packages.length} public release packages.`);
