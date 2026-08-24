/* global console, process */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoRoot = resolve(repositoryRoot, 'apps', 'demo-expo');
const cliEntrypoint = resolve(
  repositoryRoot,
  'packages',
  'cli',
  'dist',
  'index.js',
);
const deviceId = process.env.RN_OBSERVER_DEVICE_ID ?? 'emulator-5554';
const appId = 'dev.rnagentobserver.demo';
const observerEnvironment = {
  ...process.env,
  RN_OBSERVER_PROJECT_ROOT: demoRoot,
  RN_OBSERVER_DEVICE_ID: deviceId,
  RN_OBSERVER_APP_ID: appId,
};

function assert(condition, message) {
  if (!condition) throw new Error(`Android emulator smoke failed: ${message}`);
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

function adb(...args) {
  return run('adb', ['-s', deviceId, ...args]);
}

function observer(args, sessionId) {
  const output = run(process.execPath, [cliEntrypoint, ...args], {
    env: {
      ...observerEnvironment,
      ...(sessionId ? { RN_OBSERVER_SESSION_ID: sessionId } : {}),
    },
  });
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(
      `Android emulator smoke failed: ${args.join(' ')} returned non-JSON output: ${output}`,
    );
  }
}

async function waitForForeground() {
  let lastState = null;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    lastState = observer(['app-state']);
    if (lastState.processRunning && lastState.appInForeground) return lastState;
    await delay(2_000);
  }
  throw new Error(
    `Android emulator smoke failed: app did not reach foreground: ${JSON.stringify(lastState)}`,
  );
}

async function waitForContent(sessionId) {
  let lastUnderstanding = null;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    lastUnderstanding = observer(['understand-screen'], sessionId);
    if (
      lastUnderstanding.state === 'content' &&
      lastUnderstanding.counts?.visibleElements > 0 &&
      lastUnderstanding.counts?.interactiveElements > 0
    ) {
      return lastUnderstanding;
    }
    await delay(2_000);
  }
  throw new Error(
    `Android emulator smoke failed: app did not expose interactive content: ${JSON.stringify(lastUnderstanding)}`,
  );
}

assert(
  existsSync(cliEntrypoint),
  'CLI dist entrypoint is missing; run pnpm build',
);
assert(adb('get-state') === 'device', `${deviceId} is not in device state`);
assert(
  adb('shell', 'getprop', 'sys.boot_completed') === '1',
  'Android boot is incomplete',
);

await waitForForeground();
const session = observer(['session', 'start']);
assert(
  typeof session.id === 'string' && session.id.length > 0,
  'session start returned no id',
);

let stopped = false;
try {
  const understanding = await waitForContent(session.id);
  assert(
    existsSync(understanding.artifacts?.screenshotPath),
    'screen-understanding screenshot artifact is missing',
  );
  assert(
    existsSync(understanding.artifacts?.uiTreePath),
    'screen-understanding UI tree artifact is missing',
  );
  assert(
    understanding.counts?.runtimeErrors === 0,
    `screen understanding reported ${String(understanding.counts?.runtimeErrors)} actionable runtime errors: ${JSON.stringify(
      understanding.issues?.filter(
        (issue) => issue.code === 'runtime-log-error',
      ) ?? [],
    )}`,
  );

  const model = observer(['ui-model'], session.id);
  assert(
    model.availability?.status === 'available',
    `runtime UI model is ${String(model.availability?.status)}`,
  );
  assert(
    model.counts?.sourceActions > 0,
    'runtime UI model has no source actions',
  );
  assert(
    model.counts?.nativeActions > 0,
    'runtime UI model has no native actions',
  );

  const completed = observer(['session', 'stop', session.id], session.id);
  stopped = true;
  assert(
    completed.status === 'complete',
    `session ended as ${String(completed.status)}`,
  );
  const failedCaptures = completed.timeline.filter((event) =>
    ['runtime_ui_capture_failed', 'runtime_telemetry_capture_failed'].includes(
      event.type,
    ),
  );
  assert(
    failedCaptures.length === 0,
    `session contains ${failedCaptures.length} runtime capture failures`,
  );
  assert(
    completed.artifactIds.length >= 5,
    'session produced too few evidence artifacts',
  );

  console.log(
    JSON.stringify(
      {
        outcome: 'PASS',
        deviceId,
        apiLevel: adb('shell', 'getprop', 'ro.build.version.sdk'),
        appId,
        screen: {
          state: understanding.state,
          route: understanding.route,
          visibleElements: understanding.counts.visibleElements,
          interactiveElements: understanding.counts.interactiveElements,
          runtimeErrors: understanding.counts.runtimeErrors,
        },
        runtimeUi: model.counts,
        session: {
          status: completed.status,
          events: completed.timeline.length,
          artifacts: completed.artifactIds.length,
        },
      },
      null,
      2,
    ),
  );
} finally {
  if (!stopped) {
    try {
      observer(['session', 'stop', session.id], session.id);
    } catch (error) {
      console.error(
        `Best-effort session cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
