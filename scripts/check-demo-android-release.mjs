/* global console, process */

import { spawnSync } from 'node:child_process';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = await realpath(process.cwd());
const androidOutputRoot = await realpath(
  path.join(
    projectRoot,
    'apps',
    'demo-expo',
    'android',
    'app',
    'build',
    'outputs',
  ),
);
const apkPath = path.resolve(
  process.argv[2] ??
    path.join(androidOutputRoot, 'apk', 'release', 'app-release.apk'),
);
const aabPath = path.resolve(
  process.argv[3] ??
    path.join(androidOutputRoot, 'bundle', 'release', 'app-release.aab'),
);
const maxApkBytes = Number(
  process.env.RN_OBSERVER_MAX_DEMO_APK_BYTES ?? 80 * 1024 * 1024,
);
const maxAabBytes = Number(
  process.env.RN_OBSERVER_MAX_DEMO_AAB_BYTES ?? 60 * 1024 * 1024,
);

function fail(message) {
  throw new Error(`Demo Android release check failed: ${message}`);
}

async function containedRegularFile(candidate, label) {
  const resolved = await realpath(candidate);
  const relative = path.relative(androidOutputRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} is outside the generated Android output root: ${resolved}`);
  }
  const information = await stat(resolved);
  if (!information.isFile())
    fail(`${label} is not a regular file: ${resolved}`);
  return { path: resolved, bytes: information.size };
}

function numericVersion(value) {
  return value.split('.').map((part) => Number(part));
}

function descendingVersion(left, right) {
  const leftParts = numericVersion(left);
  const rightParts = numericVersion(right);
  for (
    let index = 0;
    index < Math.max(leftParts.length, rightParts.length);
    index += 1
  ) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function androidBuildTool(name) {
  const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdkRoot) fail('ANDROID_HOME or ANDROID_SDK_ROOT is required');
  const directories = (
    await readdir(path.join(sdkRoot, 'build-tools'), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(descendingVersion);
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  for (const directory of directories) {
    const candidate = path.join(sdkRoot, 'build-tools', directory, executable);
    try {
      const information = await stat(candidate);
      if (information.isFile()) return candidate;
    } catch {
      // Continue to the next installed build-tools version.
    }
  }
  fail(
    `${executable} was not found under ${path.join(sdkRoot, 'build-tools')}`,
  );
}

async function apkSignerJar() {
  const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdkRoot) fail('ANDROID_HOME or ANDROID_SDK_ROOT is required');
  const directories = (
    await readdir(path.join(sdkRoot, 'build-tools'), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(descendingVersion);
  for (const directory of directories) {
    const candidate = path.join(
      sdkRoot,
      'build-tools',
      directory,
      'lib',
      'apksigner.jar',
    );
    try {
      const information = await stat(candidate);
      if (information.isFile()) return candidate;
    } catch {
      // Continue to the next installed build-tools version.
    }
  }
  fail(
    `apksigner.jar was not found under ${path.join(sdkRoot, 'build-tools')}`,
  );
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) fail(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(
      `${label} exited with ${String(result.status)}: ${(result.stderr || result.stdout).trim()}`,
    );
  }
}

if (!Number.isSafeInteger(maxApkBytes) || maxApkBytes <= 0) {
  fail('RN_OBSERVER_MAX_DEMO_APK_BYTES must be a positive safe integer');
}
if (!Number.isSafeInteger(maxAabBytes) || maxAabBytes <= 0) {
  fail('RN_OBSERVER_MAX_DEMO_AAB_BYTES must be a positive safe integer');
}

const apk = await containedRegularFile(apkPath, 'release APK');
const aab = await containedRegularFile(aabPath, 'release AAB');
if (apk.bytes > maxApkBytes) {
  fail(`release APK is ${apk.bytes} bytes; budget is ${maxApkBytes}`);
}
if (aab.bytes > maxAabBytes) {
  fail(`release AAB is ${aab.bytes} bytes; budget is ${maxAabBytes}`);
}

const zipalign = await androidBuildTool('zipalign');
const apksigner = await apkSignerJar();
run(
  zipalign,
  ['-c', '-P', '16', '4', apk.path],
  '16 KB zip alignment verification',
);
run(
  'java',
  ['-jar', apksigner, 'verify', '--verbose', apk.path],
  'APK signature verification',
);

console.log(
  `Demo Android release is valid (APK ${(apk.bytes / 1024 / 1024).toFixed(2)} MiB, AAB ${(aab.bytes / 1024 / 1024).toFixed(2)} MiB, signed APK, 16 KB aligned).`,
);
