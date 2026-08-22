import {
  OBSERVER_VERSION,
  ObserverCore,
  asObserverError,
  type DiagnosisThresholds,
} from '@rn-agent-observer/core';

export const HELP_TEXT = `rn-observe ${OBSERVER_VERSION}

Local runtime observability bridge for React Native and Expo on Android.

Usage:
  rn-observe devices | device-info | launch | reload [--fast]
  rn-observe app-state | device-network [--window MS] | routes
  rn-observe metro-network [--duration MS] [--metro URL]
  rn-observe screenshot | ui-tree | snapshot [--interactive] | logs | performance | render-stats | network | observe
  rn-observe tap (--test-id ID | --ref E1 [--settle MS] | --x X --y Y)
  rn-observe swipe --from X,Y --to X,Y [--duration MS]
  rn-observe type-text --text VALUE | back | deep-link --uri URI
  rn-observe permissions [list] | permissions grant --perm NAME | permissions revoke --perm NAME
  rn-observe assert (--test-id ID | --text VALUE) [--visible true|false]
  rn-observe a11y-audit | app-data [--namespace NAME]
  rn-observe trace start [--duration MS] | trace stop TRACE_ID
  rn-observe record start [--duration MS] | record stop RECORDING_ID
  rn-observe replay run SCRIPT.json
  rn-observe replay export SESSION_ID
  rn-observe artifacts cleanup [--days N] [--dry-run]
  rn-observe session start | session stop [SESSION_ID] | session get SESSION_ID
  rn-observe diagnose [--ui-fps-low N --ui-fps-critical N --js-blocking N --js-blocking-high N --slow-request N --very-slow-request N --render-count N]
  rn-observe compare BEFORE.png AFTER.png [--before-ui TREE.json --after-ui TREE.json]
  rn-observe devtools-export [--duration MS] [--metro URL]
  rn-observe devtools-profile [--duration MS] [--metro URL]

Environment:
  RN_OBSERVER_PROJECT_ROOT   Target React Native project (defaults to cwd)
  RN_OBSERVER_DEVICE_ID      ADB device serial when more than one is ready
  RN_OBSERVER_APP_ID         Android package override
  RN_OBSERVER_SESSION_ID     Session receiving events/artifacts
  RN_OBSERVER_METRO_URL      Metro bundler base URL (default http://127.0.0.1:8081)

Options:
  -h, --help                Show help
  -v, --version             Show version
`;

export interface CliIO {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

const defaultIO: CliIO = {
  stdout: (value) => process.stdout.write(`${value}\n`),
  stderr: (value) => process.stderr.write(`${value}\n`),
};

function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberFlag(
  args: readonly string[],
  name: string,
  fallback?: number,
): number | undefined {
  const value = flag(args, name);
  return value === undefined ? fallback : Number(value);
}

function point(value: string | undefined): { x: number; y: number } {
  const [x, y] = value?.split(',').map(Number) ?? [];
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('Expected coordinates in X,Y format');
  }
  return { x: x ?? 0, y: y ?? 0 };
}

function diagnosisThresholdFlags(
  args: readonly string[],
): Partial<DiagnosisThresholds> {
  const uiFpsLow = numberFlag(args, '--ui-fps-low');
  const uiFpsCritical = numberFlag(args, '--ui-fps-critical');
  const jsBlockingMs = numberFlag(args, '--js-blocking');
  const jsBlockingHighMs = numberFlag(args, '--js-blocking-high');
  const slowRequestMs = numberFlag(args, '--slow-request');
  const verySlowRequestMs = numberFlag(args, '--very-slow-request');
  const renderCount = numberFlag(args, '--render-count');
  return {
    ...(uiFpsLow !== undefined ? { uiFpsLow } : {}),
    ...(uiFpsCritical !== undefined ? { uiFpsCritical } : {}),
    ...(jsBlockingMs !== undefined ? { jsBlockingMs } : {}),
    ...(jsBlockingHighMs !== undefined ? { jsBlockingHighMs } : {}),
    ...(slowRequestMs !== undefined ? { slowRequestMs } : {}),
    ...(verySlowRequestMs !== undefined ? { verySlowRequestMs } : {}),
    ...(renderCount !== undefined ? { renderCount } : {}),
  };
}

function print(io: CliIO, value: unknown): void {
  io.stdout(JSON.stringify(value, null, 2));
}

export async function runCli(
  args: readonly string[],
  io: CliIO = defaultIO,
  core = new ObserverCore(),
): Promise<number> {
  const [command, subcommand, positional] = args;
  try {
    if (
      command === undefined ||
      command === 'help' ||
      command === '--help' ||
      command === '-h'
    ) {
      io.stdout(HELP_TEXT.trimEnd());
      return 0;
    }
    if (command === '--version' || command === '-v') {
      io.stdout(OBSERVER_VERSION);
      return 0;
    }
    if (command === 'status') print(io, core.getStatus());
    else if (command === 'devices') print(io, await core.deviceList());
    else if (command === 'device-info') print(io, await core.deviceInfo());
    else if (command === 'launch') print(io, await core.appLaunch());
    else if (command === 'reload') {
      const metro = flag(args, '--metro');
      print(
        io,
        await core.appReload({
          ...(args.includes('--fast') ? { fast: true } : {}),
          ...(metro ? { metroUrl: metro } : {}),
        }),
      );
    } else if (command === 'app-state') print(io, await core.getAppState());
    else if (command === 'device-network') {
      print(
        io,
        await core.deviceNetworkDelta(numberFlag(args, '--window', 2_000)),
      );
    } else if (command === 'metro-network') {
      const metro = flag(args, '--metro');
      const duration = numberFlag(args, '--duration') ?? 5_000;
      print(
        io,
        await core.metroNetworkSnapshot({
          ...(metro ? { metroUrl: metro } : {}),
          durationMs: duration,
        }),
      );
    } else if (command === 'devtools-profile') {
      const metro = flag(args, '--metro');
      const duration = numberFlag(args, '--duration') ?? 5_000;
      print(
        io,
        await core.devtoolsProfile({
          ...(metro ? { metroUrl: metro } : {}),
          durationMs: duration,
        }),
      );
    } else if (command === 'record' && subcommand === 'start') {
      const duration = numberFlag(args, '--duration') ?? 10_000;
      print(io, await core.startRecording(duration));
    } else if (command === 'record' && subcommand === 'stop') {
      if (!positional) throw new Error('record stop requires RECORDING_ID');
      print(io, await core.stopRecording(positional));
    } else if (command === 'devtools-export') {
      const metro = flag(args, '--metro');
      const duration = numberFlag(args, '--duration') ?? 5_000;
      print(
        io,
        await core.devtoolsExport({
          ...(metro ? { metroUrl: metro } : {}),
          durationMs: duration,
        }),
      );
    } else if (command === 'screenshot') print(io, await core.screenshot());
    else if (command === 'ui-tree') print(io, await core.getUiTree());
    else if (command === 'snapshot') {
      print(
        io,
        await core.snapshot({
          ...(args.includes('-i') || args.includes('--interactive')
            ? { interactiveOnly: true }
            : {}),
        }),
      );
    } else if (command === 'tap') {
      const testId = flag(args, '--test-id');
      const ref = flag(args, '--ref');
      const settle = numberFlag(args, '--settle');
      print(
        io,
        ref
          ? await core.press(ref, settle)
          : await core.tap(
              testId
                ? { testId }
                : {
                    x: numberFlag(args, '--x') ?? Number.NaN,
                    y: numberFlag(args, '--y') ?? Number.NaN,
                  },
            ),
      );
    } else if (command === 'deep-link') {
      const uri = flag(args, '--uri');
      if (uri === undefined) throw new Error('deep-link requires --uri');
      print(io, await core.deepLink(uri));
    } else if (command === 'permissions') {
      if (subcommand === 'grant' || subcommand === 'revoke') {
        const perm = flag(args, '--perm');
        if (perm === undefined) throw new Error('--perm is required');
        print(io, await core.setPermission(perm, subcommand === 'grant'));
      } else {
        print(io, await core.listPermissions());
      }
    } else if (command === 'assert') {
      const testId = flag(args, '--test-id');
      const text = flag(args, '--text');
      const visible = flag(args, '--visible');
      print(
        io,
        await core.assertElement({
          ...(testId ? { testId } : {}),
          ...(text ? { text } : {}),
          ...(visible !== undefined ? { visible: visible === 'true' } : {}),
        }),
      );
    } else if (command === 'a11y-audit') {
      print(io, await core.a11yAudit());
    } else if (command === 'app-data') {
      const namespace = flag(args, '--namespace');
      const events = await core.getAppData();
      print(
        io,
        namespace
          ? events.filter((event) => event.namespace === namespace)
          : events,
      );
    } else if (command === 'routes') {
      print(io, core.listRoutes());
    } else if (command === 'replay' && subcommand === 'run') {
      if (!positional) throw new Error('replay run requires SCRIPT.json');
      print(io, await core.runReplay(positional));
    } else if (command === 'replay' && subcommand === 'export') {
      if (!positional) throw new Error('replay export requires SESSION_ID');
      print(io, core.exportReplayScript(positional));
    } else if (command === 'artifacts' && subcommand === 'cleanup') {
      const days = numberFlag(args, '--days') ?? 14;
      print(
        io,
        core.cleanupArtifacts({
          olderThanDays: days,
          ...(args.includes('--dry-run') ? { dryRun: true } : {}),
        }),
      );
    } else if (command === 'swipe') {
      print(
        io,
        await core.swipe(
          point(flag(args, '--from')),
          point(flag(args, '--to')),
          numberFlag(args, '--duration', 500),
        ),
      );
    } else if (command === 'type-text') {
      const text = flag(args, '--text');
      if (text === undefined) throw new Error('--text is required');
      print(io, await core.typeText(text));
    } else if (command === 'back') print(io, await core.back());
    else if (command === 'logs') {
      const level = flag(args, '--level') as
        'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | undefined;
      const keyword = flag(args, '--keyword');
      const limit = numberFlag(args, '--limit');
      print(
        io,
        await core.getLogs({
          ...(level ? { level } : {}),
          ...(keyword ? { keyword } : {}),
          ...(limit ? { limit } : {}),
        }),
      );
    } else if (command === 'performance')
      print(io, await core.performanceSnapshot());
    else if (command === 'render-stats') {
      print(io, { renders: await core.getReactRenderStats() });
    } else if (command === 'network') {
      print(
        io,
        subcommand === 'requests'
          ? await core.getNetworkRequests()
          : await core.getNetworkSummary(),
      );
    } else if (command === 'observe') print(io, await core.observeScreen());
    else if (command === 'trace' && subcommand === 'start') {
      print(io, await core.startTrace(numberFlag(args, '--duration', 10_000)));
    } else if (command === 'trace' && subcommand === 'stop') {
      if (!positional) throw new Error('trace stop requires TRACE_ID');
      print(io, await core.stopTrace(positional));
    } else if (command === 'session' && subcommand === 'start') {
      print(io, core.startSession());
    } else if (command === 'session' && subcommand === 'stop') {
      print(io, core.stopSession(positional));
    } else if (command === 'session' && subcommand === 'get') {
      if (!positional) throw new Error('session get requires SESSION_ID');
      print(io, core.getSession(positional));
    } else if (command === 'diagnose') {
      print(io, await core.diagnose(diagnosisThresholdFlags(args)));
    } else if (command === 'compare') {
      if (!subcommand || !positional) {
        throw new Error('compare requires BEFORE.png AFTER.png');
      }
      const beforeUi = flag(args, '--before-ui');
      const afterUi = flag(args, '--after-ui');
      if ((beforeUi && !afterUi) || (!beforeUi && afterUi)) {
        throw new Error('--before-ui and --after-ui must be provided together');
      }
      print(
        io,
        core.compareScreens(
          subcommand,
          positional,
          beforeUi && afterUi
            ? { before: beforeUi, after: afterUi }
            : undefined,
        ),
      );
    } else {
      throw new Error(`Unknown command: ${args.join(' ')}`);
    }
    return 0;
  } catch (error) {
    io.stderr(JSON.stringify(asObserverError(error).toJSON(), null, 2));
    return 2;
  }
}
