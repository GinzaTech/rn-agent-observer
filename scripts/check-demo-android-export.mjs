/* global console, process */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const projectRoot = process.cwd();
const demoRoot = path.join(projectRoot, 'apps', 'demo-expo');
const temporaryRoot = path.resolve(tmpdir());
const outputDirectory = await mkdtemp(
  path.join(temporaryRoot, 'rn-observer-android-export-'),
);

function fail(message) {
  throw new Error(`Demo Android export check failed: ${message}`);
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(entryPath) : [entryPath];
    }),
  );
  return files.flat();
}

async function runExpoExport() {
  const require = createRequire(import.meta.url);
  const expoCli = require.resolve('expo/bin/cli', { paths: [demoRoot] });
  const args = [
    expoCli,
    'export',
    '--platform',
    'android',
    '--output-dir',
    outputDirectory,
  ];
  const environment = { ...process.env, CI: 'true' };
  delete environment.RN_OBSERVER_SECURITY_LAB;

  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: demoRoot,
      env: environment,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `Expo export exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}`,
        ),
      );
    });
  });
}

try {
  await runExpoExport();
  const metadataPath = path.join(outputDirectory, 'metadata.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  if (typeof metadata !== 'object' || metadata === null) {
    fail('metadata.json does not contain an object.');
  }

  const files = await filesBelow(outputDirectory);
  const androidBundles = files.filter((file) => {
    const relative = path.relative(outputDirectory, file).replaceAll('\\', '/');
    return (
      relative.includes('/static/js/android/') && relative.endsWith('.hbc')
    );
  });
  if (androidBundles.length !== 1) {
    fail(`expected one Android Hermes bundle, found ${androidBundles.length}.`);
  }

  console.log(
    `Demo Android export is valid (${files.length} files, one Hermes bundle).`,
  );
} finally {
  const resolvedOutput = path.resolve(outputDirectory);
  if (
    path.dirname(resolvedOutput) !== temporaryRoot ||
    !path.basename(resolvedOutput).startsWith('rn-observer-android-export-')
  ) {
    fail(`refusing to remove unexpected path: ${resolvedOutput}`);
  }
  await rm(resolvedOutput, { recursive: true, force: true });
}
