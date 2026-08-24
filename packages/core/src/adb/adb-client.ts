import { XMLParser } from 'fast-xml-parser';
import type {
  AppState,
  Device,
  DeviceNetworkDelta,
  DeviceNetworkSample,
  LogEntry,
  PerformanceSnapshot,
  UITree,
} from '@rn-agent-observer/schemas';
import { ObserverError } from '../errors.js';
import { runProcess } from '../process.js';
import {
  flattenUiTree,
  networkInterfaceDeltas,
  normalizeUiNode,
  parseAdbDevices,
  parseFrameTimes,
  parseLogcat,
  parsePermissionChangeExitStatus,
  parseProcNetDev,
  parseResumedActivity,
  parseRuntimePermissions,
  parseTopCpuPercent,
  parseTotalPssMb,
  type PermissionState,
} from './parsers.js';

interface UiDump {
  hierarchy?: { node?: unknown };
}

/**
 * `adb shell` receives a command string, even when the host process gets an
 * argv array. Quote every remote argument so URI query delimiters and user
 * input cannot be reinterpreted by Android's shell.
 */
const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;

export class AdbClient {
  constructor(
    readonly deviceId?: string,
    readonly executable = process.env.RN_OBSERVER_ADB ?? 'adb',
  ) {}

  private args(args: readonly string[]): string[] {
    return this.deviceId ? ['-s', this.deviceId, ...args] : [...args];
  }

  async run(args: readonly string[], timeoutMs = 30_000): Promise<Buffer> {
    // Transient adb failures (device restarting, USB hiccup, adb server
    // restarting under load) get a small bounded retry before surfacing.
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await runProcess(
          this.executable,
          this.args(args),
          timeoutMs,
        );
        if (result.exitCode === 0) return result.stdout;
        const stderr = result.stderr;
        lastError = new ObserverError(
          'ADB_COMMAND_FAILED',
          stderr ||
            result.stdout.toString('utf8').trim() ||
            `adb exited ${result.exitCode}`,
          true,
          'Run adb devices -l and verify the selected device',
        );
        const transient =
          /device (?:offline|not found|unauthorized)|closed|reset by peer|timed out|more than one device/i.test(
            stderr,
          );
        if (!transient || attempt === maxAttempts) {
          throw lastError;
        }
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const transient =
          /timed out|ECONNRESET|ENOENT|EPERM|device (?:offline|not found)/i.test(
            message,
          );
        if (!transient || attempt === maxAttempts) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
    throw lastError;
  }

  async text(args: readonly string[], timeoutMs?: number): Promise<string> {
    return (await this.run(args, timeoutMs)).toString('utf8').trim();
  }

  async shell(args: readonly string[], timeoutMs?: number): Promise<string> {
    return this.text(['shell', args.map(shellQuote).join(' ')], timeoutMs);
  }

  async listDevices(): Promise<Device[]> {
    return parseAdbDevices(await this.text(['devices', '-l']));
  }

  async resolveDeviceId(): Promise<string> {
    if (this.deviceId) return this.deviceId;
    const available = (await this.listDevices()).filter(
      (device) => device.state === 'device',
    );
    if (available.length === 0) {
      throw new ObserverError(
        'DEVICE_NOT_FOUND',
        'No ready Android device is available',
        true,
        'Start an emulator or connect a device',
      );
    }
    if (available.length > 1) {
      throw new ObserverError(
        'MULTIPLE_DEVICES',
        `Multiple devices are ready: ${available.map((device) => device.id).join(', ')}`,
        true,
        'Set RN_OBSERVER_DEVICE_ID or pass deviceId explicitly',
      );
    }
    return available[0]?.id ?? '';
  }

  async selected(): Promise<AdbClient> {
    return this.deviceId
      ? this
      : new AdbClient(await this.resolveDeviceId(), this.executable);
  }

  async deviceInfo(): Promise<Device> {
    const client = await this.selected();
    const [model, osVersion, size, density, input, display] = await Promise.all(
      [
        client.shell(['getprop', 'ro.product.model']),
        client.shell(['getprop', 'ro.build.version.release']),
        client.shell(['wm', 'size']),
        client.shell(['wm', 'density']),
        client.shell(['dumpsys', 'input']),
        client.shell(['dumpsys', 'display']),
      ],
    );
    const sizeMatches = [
      ...size.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g),
    ];
    const sizeMatch = sizeMatches.at(-1);
    const densityMatches = [
      ...density.matchAll(/(?:Physical|Override) density:\s*(\d+)/g),
    ];
    const orientationValue = Number(
      input.match(/SurfaceOrientation:\s*(\d+)/)?.[1] ??
        display.match(/mCurrentOrientation=(\d+)/)?.[1] ??
        display.match(/\brotation\s+(\d+)/)?.[1] ??
        -1,
    );
    return {
      id: client.deviceId ?? '',
      platform: 'android',
      state: 'device',
      model,
      osVersion,
      ...(sizeMatch
        ? {
            resolution: {
              width: Number(sizeMatch[1]),
              height: Number(sizeMatch[2]),
            },
          }
        : {}),
      ...(densityMatches.at(-1)?.[1]
        ? { densityDpi: Number(densityMatches.at(-1)?.[1]) }
        : {}),
      orientation:
        orientationValue === 0 || orientationValue === 2
          ? 'portrait'
          : orientationValue === 1 || orientationValue === 3
            ? 'landscape'
            : 'unknown',
    };
  }

  async launch(appId: string): Promise<void> {
    const client = await this.selected();
    await client.shell([
      'monkey',
      '-p',
      appId,
      '-c',
      'android.intent.category.LAUNCHER',
      '1',
    ]);
  }

  async reload(appId: string): Promise<void> {
    const client = await this.selected();
    await client.shell(['am', 'force-stop', appId]);
    await client.launch(appId);
  }

  async screenshot(): Promise<Buffer> {
    return (await this.selected()).run(['exec-out', 'screencap', '-p']);
  }

  async uiTree(): Promise<UITree> {
    const client = await this.selected();
    const remote = '/sdcard/rn-agent-observer-window.xml';
    try {
      await client.shell(['uiautomator', 'dump', remote]);
    } catch (error) {
      // Some Android builds exit non-zero after a successful dump while the
      // "dumped to" confirmation lands on stderr. Trust the dump, then verify
      // by reading the file.
      const message =
        error instanceof ObserverError ? error.message : String(error);
      if (!/dumped to/i.test(message)) throw error;
    }
    const xml = await client.text(['exec-out', 'cat', remote]);
    if (!xml.includes('<hierarchy') && !xml.includes('<node')) {
      throw new ObserverError(
        'UI_TREE_UNAVAILABLE',
        'UIAutomator did not produce a window dump',
        true,
        'Ensure the screen is not locked and retry ui-tree',
      );
    }
    const parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
    }).parse(xml) as UiDump;
    const raw = parsed.hierarchy?.node;
    const rawRoots = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    return {
      roots: rawRoots.map((node) =>
        normalizeUiNode(node as Parameters<typeof normalizeUiNode>[0]),
      ),
      timestamp: new Date().toISOString(),
      source: 'android-uiautomator',
    };
  }

  async findElement(testId: string) {
    const tree = await this.uiTree();
    const element = flattenUiTree(tree.roots).find(
      (item) =>
        item.id === testId ||
        item.resourceId?.endsWith(`/${testId}`) ||
        item.contentDescription === testId ||
        item.text === testId,
    );
    if (!element?.bounds) {
      throw new ObserverError(
        'UI_ELEMENT_NOT_FOUND',
        `No bounded UI element matched "${testId}"`,
        true,
        'Inspect get_ui_tree and use a visible id, label, or text',
      );
    }
    return element;
  }

  async tap(
    target: { x: number; y: number } | { testId: string },
  ): Promise<void> {
    const client = await this.selected();
    if (
      !('testId' in target) &&
      (!Number.isFinite(target.x) || !Number.isFinite(target.y))
    ) {
      throw new ObserverError(
        'INVALID_ARGUMENT',
        'Tap requires finite x and y coordinates or a testID',
        true,
        'Use --test-id ID or provide both --x and --y',
      );
    }
    const point =
      'testId' in target
        ? await client.findElement(target.testId).then((element) => ({
            x: Math.round(
              (element.bounds?.x ?? 0) + (element.bounds?.width ?? 0) / 2,
            ),
            y: Math.round(
              (element.bounds?.y ?? 0) + (element.bounds?.height ?? 0) / 2,
            ),
          }))
        : target;
    await client.shell(['input', 'tap', String(point.x), String(point.y)]);
  }

  async swipe(
    start: { x: number; y: number },
    end: { x: number; y: number },
    durationMs = 500,
  ): Promise<void> {
    if (
      ![start.x, start.y, end.x, end.y, durationMs].every(Number.isFinite) ||
      durationMs <= 0
    ) {
      throw new ObserverError(
        'INVALID_ARGUMENT',
        'Swipe coordinates and positive duration must be finite numbers',
        true,
      );
    }
    await (
      await this.selected()
    ).shell([
      'input',
      'swipe',
      String(start.x),
      String(start.y),
      String(end.x),
      String(end.y),
      String(durationMs),
    ]);
  }

  async typeText(value: string): Promise<void> {
    await (
      await this.selected()
    ).shell(['input', 'text', value.replaceAll(' ', '%s')]);
  }

  async back(): Promise<void> {
    await (await this.selected()).shell(['input', 'keyevent', '4']);
  }

  async logs(
    appId: string,
    limit = 500,
  ): Promise<{
    entries: LogEntry[];
    pidFilterApplied: boolean;
    processId: number | null;
  }> {
    const client = await this.selected();
    const pid = await client.shell(['pidof', appId]).catch(() => '');
    const args = ['logcat', '-d', '-v', 'epoch', '-t', String(limit)];
    const pidValue = pid.split(/\s+/)[0] ?? '';
    if (pidValue) args.push(`--pid=${pidValue}`);
    return {
      entries: parseLogcat(await client.text(args)),
      pidFilterApplied: pidValue !== '',
      processId:
        pidValue !== '' &&
        Number.isInteger(Number(pidValue)) &&
        Number(pidValue) > 0
          ? Number(pidValue)
          : null,
    };
  }

  async appState(appId: string): Promise<AppState> {
    const client = await this.selected();
    const [pidOutput, activityOutput] = await Promise.all([
      client.shell(['pidof', appId]).catch(() => ''),
      client.shell(['dumpsys', 'activity', 'activities']).catch(() => ''),
    ]);
    const pidValue = pidOutput.split(/\s+/)[0] ?? '';
    const pid = Number(pidValue);
    const foregroundActivity = parseResumedActivity(activityOutput);
    return {
      appId,
      processRunning: pidValue !== '',
      ...(pidValue !== '' && Number.isFinite(pid) && pid > 0
        ? { pid }
        : { pid: null }),
      foregroundActivity,
      appInForeground: foregroundActivity?.startsWith(`${appId}/`) ?? false,
      source: 'adb-pidof+dumpsys-activity',
      timestamp: new Date().toISOString(),
    };
  }

  async deepLink(appId: string, uri: string): Promise<void> {
    const client = await this.selected();
    await client.shell([
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      uri,
      '-p',
      appId,
    ]);
  }

  async runtimePermissions(appId: string): Promise<PermissionState[]> {
    const client = await this.selected();
    return parseRuntimePermissions(
      await client.shell(['dumpsys', 'package', appId]),
    );
  }

  async setPermission(
    appId: string,
    permission: string,
    granted: boolean,
  ): Promise<void> {
    const client = await this.selected();
    await client.shell(['pm', granted ? 'grant' : 'revoke', appId, permission]);
  }

  async permissionChangeExitStatus(
    appId: string,
    processId: number,
  ): Promise<ReturnType<typeof parsePermissionChangeExitStatus>> {
    if (!Number.isInteger(processId) || processId <= 0) {
      return 'unavailable';
    }
    const client = await this.selected();
    return parsePermissionChangeExitStatus(
      await client.shell(['dumpsys', 'activity', 'exit-info', appId]),
      appId,
      processId,
    );
  }

  async deviceNetworkSample(): Promise<DeviceNetworkSample> {
    const client = await this.selected();
    const output = await client.shell(['cat', '/proc/net/dev']).catch(() => '');
    return {
      timestamp: new Date().toISOString(),
      interfaces: parseProcNetDev(output),
      source: 'adb-proc-net-dev',
    };
  }

  async deviceNetworkDelta(windowMs = 2_000): Promise<DeviceNetworkDelta> {
    const clampedWindow = Math.max(500, Math.min(windowMs, 30_000));
    const start = await this.deviceNetworkSample();
    await new Promise((resolve) => setTimeout(resolve, clampedWindow));
    const end = await this.deviceNetworkSample();
    return {
      windowMs: clampedWindow,
      start,
      end,
      deltas: networkInterfaceDeltas(start.interfaces, end.interfaces),
      source: 'adb-proc-net-dev-delta',
    };
  }

  /**
   * Measures device-host clock skew by comparing the device's realtime
   * clock against the host clock across a single adb round-trip. Positive
   * values mean the device clock runs ahead of the host. Evidence
   * timestamps that cross the boundary should disclose this skew.
   */
  async clockSkewMs(): Promise<number | null> {
    const client = await this.selected();
    const before = Date.now();
    const deviceEpoch = await client
      .shell(['echo', '$EPOCHREALTIME'])
      .catch(() => '');
    const after = Date.now();
    const value = Number(deviceEpoch.trim());
    if (!Number.isFinite(value) || deviceEpoch.trim() === '') return null;
    const hostMid = (before + after) / 2;
    return Math.round((value * 1_000 - hostMid) * 10) / 10;
  }

  async performance(appId: string): Promise<PerformanceSnapshot> {
    const client = await this.selected();
    const timestamp = new Date().toISOString();
    const pid =
      (await client.shell(['pidof', appId]).catch(() => '')).split(/\s+/)[0] ??
      '';
    const [gfx, memory, display, top] = await Promise.all([
      client.shell(['dumpsys', 'gfxinfo', appId, 'framestats']),
      client.shell(['dumpsys', 'meminfo', appId]),
      client.shell(['dumpsys', 'display']),
      pid
        ? client.shell(['top', '-b', '-n', '1', '-p', pid]).catch(() => '')
        : Promise.resolve(''),
    ]);
    const frames = parseFrameTimes(gfx).slice(-240);
    const frameTime = frames.length
      ? frames.reduce((sum, value) => sum + value, 0) / frames.length
      : null;
    const worstFrame = frames.length ? Math.max(...frames) : null;
    const refreshHz = Number(
      display.match(/renderFrameRate\s+(\d+(?:\.\d+)?)/)?.[1] ?? 60,
    );
    const dropped = frames.filter((value) => value > 1000 / refreshHz).length;
    const memoryMb = parseTotalPssMb(memory);
    const cpuPercent = parseTopCpuPercent(top);
    const metric = (
      name: string,
      value: number | null,
      unit: string,
      reason?: string,
    ) => ({
      name,
      value,
      unit,
      source:
        name === 'memory_mb'
          ? 'adb-dumpsys-meminfo'
          : name === 'cpu_percent'
            ? 'adb-top'
            : name === 'display_refresh_hz'
              ? 'adb-dumpsys-display'
              : 'adb-dumpsys-gfxinfo',
      timestamp,
      available: value !== null,
      ...(value === null && reason ? { reason } : {}),
    });
    return {
      timestamp,
      metrics: [
        metric(
          'ui_fps',
          frameTime === null
            ? null
            : Math.min(refreshHz, 1000 / Math.max(frameTime, 0.01)),
          'fps',
          'No gfx frame rows were available',
        ),
        metric(
          'frame_time_ms',
          frameTime,
          'ms',
          'No gfx frame rows were available',
        ),
        metric(
          'worst_frame_ms',
          worstFrame,
          'ms',
          'No gfx frame rows were available',
        ),
        metric(
          'dropped_frames',
          frames.length ? dropped : null,
          'frames',
          'No gfx frame rows were available',
        ),
        metric(
          'frame_sample_count',
          frames.length || null,
          'frames',
          'No gfx frame rows were available',
        ),
        metric('display_refresh_hz', refreshHz, 'Hz'),
        metric('memory_mb', memoryMb, 'MB', 'Process memory was unavailable'),
        metric('cpu_percent', cpuPercent, '%', 'Process CPU was unavailable'),
        metric(
          'js_fps',
          null,
          'fps',
          'ADB does not expose a trustworthy JS FPS signal',
        ),
        metric(
          'js_blocking_ms',
          null,
          'ms',
          'Requires React Native runtime instrumentation',
        ),
      ],
    };
  }
}
