import type { PerformanceSnapshot } from '@rn-agent-observer/schemas';

export interface AndroidShellExecutor {
  shell(args: readonly string[], timeoutMs?: number): Promise<string>;
}

export interface AndroidColdStartPreparation {
  prepared: boolean;
  reason?: string;
}

export interface AndroidStartupMeasurement {
  snapshot: PerformanceSnapshot;
  launchState: string | null;
  activity: string | null;
  limitations: string[];
}

interface ParsedAmStartWait {
  status: string | null;
  launchState: string | null;
  activity: string | null;
  thisTimeMs: number | null;
  totalTimeMs: number | null;
  waitTimeMs: number | null;
}

const APP_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u;

const numericField = (value: string | undefined): number | null => {
  if (value === undefined || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

export const parseAmStartWait = (source: string): ParsedAmStartWait => {
  const fields = new Map<string, string>();
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z]+):\s*(.*?)\s*$/u.exec(line);
    const key = match?.[1];
    const value = match?.[2];
    if (key && value !== undefined) fields.set(key, value);
  }
  return {
    status: fields.get('Status') ?? null,
    launchState: fields.get('LaunchState')?.toUpperCase() ?? null,
    activity: fields.get('Activity') ?? null,
    thisTimeMs: numericField(fields.get('ThisTime')),
    totalTimeMs: numericField(fields.get('TotalTime')),
    waitTimeMs: numericField(fields.get('WaitTime')),
  };
};

const assertAppId = (appId: string): void => {
  if (!APP_ID_PATTERN.test(appId)) {
    throw new TypeError('Android appId has an invalid package-name format');
  }
};

export const prepareAndroidColdStart = async (
  executor: AndroidShellExecutor,
  appId: string,
): Promise<AndroidColdStartPreparation> => {
  assertAppId(appId);
  try {
    await executor.shell(['am', 'force-stop', appId]);
    const pid = await executor.shell(['pidof', appId]).catch(() => '');
    return pid.trim().length === 0
      ? { prepared: true }
      : {
          prepared: false,
          reason: 'The app process was still running after force-stop',
        };
  } catch {
    return {
      prepared: false,
      reason: 'Android force-stop preparation was unavailable',
    };
  }
};

const unavailableSnapshot = (
  timestamp: string,
  reason: string,
): PerformanceSnapshot => ({
  timestamp,
  metrics: [
    'cold_start_this_time_ms',
    'cold_start_total_time_ms',
    'cold_start_wait_time_ms',
  ].map((name) => ({
    name,
    value: null,
    unit: 'ms',
    source: 'adb-am-start-w',
    timestamp,
    available: false,
    reason,
  })),
});

const launcherActivity = async (
  executor: AndroidShellExecutor,
  appId: string,
): Promise<string | null> => {
  const output = await executor
    .shell([
      'cmd',
      'package',
      'resolve-activity',
      '--brief',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
      appId,
    ])
    .catch(() => '');
  const candidates = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${appId}/`));
  return candidates.at(-1) ?? null;
};

export const measureAndroidColdStart = async (
  executor: AndroidShellExecutor,
  appId: string,
  preparation: AndroidColdStartPreparation,
  options: { now?: () => Date } = {},
): Promise<AndroidStartupMeasurement> => {
  assertAppId(appId);
  const timestamp = (options.now?.() ?? new Date()).toISOString();
  if (!preparation.prepared) {
    const reason =
      preparation.reason ?? 'Cold-start preparation was not verified';
    return {
      snapshot: unavailableSnapshot(timestamp, reason),
      launchState: null,
      activity: null,
      limitations: [reason],
    };
  }
  const activity = await launcherActivity(executor, appId);
  if (!activity) {
    const reason = 'The Android launcher activity could not be resolved';
    return {
      snapshot: unavailableSnapshot(timestamp, reason),
      launchState: null,
      activity: null,
      limitations: [reason],
    };
  }
  let output: string;
  try {
    output = await executor.shell(
      [
        'am',
        'start',
        '-W',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        'android.intent.category.LAUNCHER',
        '-n',
        activity,
      ],
      60_000,
    );
  } catch {
    const reason = 'Android am start -W measurement failed';
    return {
      snapshot: unavailableSnapshot(timestamp, reason),
      launchState: null,
      activity,
      limitations: [reason],
    };
  }
  const parsed = parseAmStartWait(output);
  const provenCold =
    parsed.status?.toLowerCase() === 'ok' && parsed.launchState === 'COLD';
  const commonReason = !provenCold
    ? parsed.launchState
      ? `Android reported LaunchState=${parsed.launchState}, not COLD`
      : 'Android did not report LaunchState=COLD'
    : undefined;
  const metric = (
    name: string,
    value: number | null,
  ): PerformanceSnapshot['metrics'][number] => ({
    name,
    value: provenCold ? value : null,
    unit: 'ms',
    source: 'adb-am-start-w',
    timestamp,
    available: provenCold && value !== null,
    ...(!provenCold || value === null
      ? {
          reason:
            commonReason ?? `Android did not report ${name} for this launch`,
        }
      : {}),
  });
  const limitations = [
    'adb am start -W measures Android launch display timing; it does not prove React Native time-to-interactive or time-to-full-display',
    ...(!provenCold && commonReason ? [commonReason] : []),
  ];
  return {
    snapshot: {
      timestamp,
      metrics: [
        metric('cold_start_this_time_ms', parsed.thisTimeMs),
        metric('cold_start_total_time_ms', parsed.totalTimeMs),
        metric('cold_start_wait_time_ms', parsed.waitTimeMs),
      ],
    },
    launchState: parsed.launchState,
    activity: parsed.activity ?? activity,
    limitations,
  };
};
