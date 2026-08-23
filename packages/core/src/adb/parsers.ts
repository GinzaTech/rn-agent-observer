import type {
  Device,
  LogEntry,
  NetworkInterfaceSample,
  UIElement,
} from '@rn-agent-observer/schemas';

export function parseAdbDevices(output: string): Device[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id = '', state = '', ...properties] = line.split(/\s+/);
      const model = properties
        .find((part) => part.startsWith('model:'))
        ?.slice(6);
      return {
        id,
        platform: 'android' as const,
        state,
        ...(model ? { model: model.replaceAll('_', ' ') } : {}),
      };
    });
}

export function parseBounds(value: string | undefined) {
  const match = value?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return undefined;
  const [, x1 = '0', y1 = '0', x2 = '0', y2 = '0'] = match;
  return {
    x: Number(x1),
    y: Number(y1),
    width: Number(x2) - Number(x1),
    height: Number(y2) - Number(y1),
  };
}

interface RawUiNode {
  index?: string;
  text?: string;
  'resource-id'?: string;
  class?: string;
  'content-desc'?: string;
  clickable?: string;
  enabled?: string;
  selected?: string;
  focusable?: string;
  displayed?: string;
  bounds?: string;
  node?: RawUiNode | RawUiNode[];
}

export function normalizeUiNode(raw: RawUiNode): UIElement {
  const rawChildren =
    raw.node === undefined
      ? []
      : Array.isArray(raw.node)
        ? raw.node
        : [raw.node];
  const resourceId = raw['resource-id'] || undefined;
  return {
    ...(resourceId ? { id: resourceId.split('/').at(-1), resourceId } : {}),
    type: raw.class?.split('.').at(-1) ?? 'View',
    ...(raw.text ? { text: raw.text } : {}),
    ...(raw['content-desc'] ? { contentDescription: raw['content-desc'] } : {}),
    ...(raw.class ? { className: raw.class } : {}),
    ...(parseBounds(raw.bounds) ? { bounds: parseBounds(raw.bounds) } : {}),
    clickable: raw.clickable === 'true',
    enabled: raw.enabled !== 'false',
    selected: raw.selected === 'true',
    focusable: raw.focusable === 'true',
    visible: raw.displayed !== 'false',
    children: rawChildren.map(normalizeUiNode),
  };
}

export function flattenUiTree(roots: UIElement[]): UIElement[] {
  return roots.flatMap((root) => [root, ...flattenUiTree(root.children)]);
}

const LOG_LEVELS: Record<string, LogEntry['level']> = {
  V: 'trace',
  D: 'debug',
  I: 'info',
  W: 'warn',
  E: 'error',
  F: 'fatal',
};

export function parseLogcat(output: string): LogEntry[] {
  return output
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(
        /^\s*(\d+\.\d+)\s+\d+\s+\d+\s+([VDIWEF])\s+([^:]+):\s?(.*)$/,
      );
      if (!match) return null;
      const [, epoch = '0', priority = 'I', tag = 'android', message = ''] =
        match;
      return {
        level: LOG_LEVELS[priority] ?? 'info',
        message,
        source: tag.trim(),
        timestamp: new Date(Number(epoch) * 1000).toISOString(),
      } satisfies LogEntry;
    })
    .filter((entry): entry is LogEntry => entry !== null);
}

export function parseFrameTimes(output: string): number[] {
  const marker = 'Draw\tPrepare\tProcess\tExecute';
  const start = output.indexOf(marker);
  if (start >= 0) {
    return output
      .slice(start + marker.length)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^\d/.test(line))
      .map((line) =>
        line.split(/\s+/).reduce((sum, value) => sum + Number(value), 0),
      )
      .filter(Number.isFinite);
  }
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  const headerIndex = lines.findIndex((line) =>
    line.startsWith('Flags,FrameTimelineVsyncId,IntendedVsync'),
  );
  if (headerIndex < 0) return [];
  const header = lines[headerIndex]?.split(',') ?? [];
  const intendedIndex = header.indexOf('IntendedVsync');
  const completedIndex = header.indexOf('FrameCompleted');
  if (intendedIndex < 0 || completedIndex < 0) return [];
  const frames: number[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (line === '---PROFILEDATA---') break;
    if (!/^\d+,/.test(line)) continue;
    const values = line.split(',');
    const intended = Number(values[intendedIndex]);
    const completed = Number(values[completedIndex]);
    const durationMs = (completed - intended) / 1_000_000;
    if (Number.isFinite(durationMs) && durationMs >= 0 && durationMs < 10_000) {
      frames.push(durationMs);
    }
  }
  return frames;
}

export function parseTotalPssMb(output: string): number | null {
  const match = output.match(/TOTAL\s+(\d+)/);
  return match ? Number(match[1]) / 1024 : null;
}

export function parseTopCpuPercent(output: string): number | null {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headerIndex = lines.findIndex((line) =>
    line.split(/\s+/).some((token) => token.includes('CPU')),
  );
  if (headerIndex < 0) return null;
  const headers = lines[headerIndex]?.split(/\s+/) ?? [];
  const cpuHeaderIndex = headers.findIndex((token) => token.includes('CPU'));
  const cpuIndex = headers[cpuHeaderIndex]?.startsWith('S[')
    ? cpuHeaderIndex + 1
    : cpuHeaderIndex;
  if (cpuIndex < 0) return null;
  const row = lines.slice(headerIndex + 1).find((line) => /^\d+\s/.test(line));
  const raw = row?.split(/\s+/)[cpuIndex]?.replace('%', '');
  const value = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Extracts the resumed Android activity from `dumpsys activity activities`.
 * Returns "package/.ActivityName" or null when parsing fails.
 */
export function parseResumedActivity(output: string): string | null {
  const match = output.match(
    /(?:topResumedActivity=|ResumedActivity:)\s*ActivityRecord\{[0-9a-f]+\s+\S+\s+([^\s}]+)\/([^\s}]+)/,
  );
  if (!match) return null;
  const pkg = match[1];
  const activity = match[2];
  if (!pkg || !activity) return null;
  return `${pkg}/${activity}`;
}

/**
 * Parses `/proc/net/dev` output into per-interface byte counters.
 * The loopback interface is excluded because it never leaves the device.
 */
export function parseProcNetDev(output: string): NetworkInterfaceSample[] {
  const samples: NetworkInterfaceSample[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(
      /^\s*([A-Za-z0-9._-]+):\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/,
    );
    if (!match) continue;
    const interfaceName = match[1];
    const rx = Number(match[2] ?? Number.NaN);
    const tx = Number(match[3] ?? Number.NaN);
    if (
      interfaceName === undefined ||
      interfaceName === 'lo' ||
      !Number.isFinite(rx) ||
      !Number.isFinite(tx)
    ) {
      continue;
    }
    samples.push({ interfaceName, rxBytes: rx, txBytes: tx });
  }
  return samples;
}

export function networkInterfaceDeltas(
  start: NetworkInterfaceSample[],
  end: NetworkInterfaceSample[],
): NetworkInterfaceSample[] {
  const startByName = new Map(start.map((item) => [item.interfaceName, item]));
  return end
    .filter((item) => startByName.has(item.interfaceName))
    .map((item) => {
      const before = startByName.get(item.interfaceName);
      return {
        interfaceName: item.interfaceName,
        rxBytes: Math.max(0, item.rxBytes - (before?.rxBytes ?? 0)),
        txBytes: Math.max(0, item.txBytes - (before?.txBytes ?? 0)),
      };
    });
}

export interface PermissionState {
  name: string;
  granted: boolean;
}

export type PermissionChangeExitStatus =
  'permission-change' | 'unexpected' | 'unavailable';

/**
 * Extracts only the safe exit classification required to distinguish Android's
 * expected runtime-permission process termination from a crash or ANR. Raw
 * dumpsys descriptions are deliberately never returned or persisted.
 */
export function parsePermissionChangeExitStatus(
  output: string,
  expectedPackage: string,
  expectedPid: number,
): PermissionChangeExitStatus {
  if (
    !/^[A-Za-z0-9._]+$/u.test(expectedPackage) ||
    !Number.isInteger(expectedPid) ||
    expectedPid <= 0
  ) {
    return 'unavailable';
  }
  const packageMatch = output.match(/^\s*package:\s*(\S+)\s*$/mu);
  if (packageMatch?.[1] !== expectedPackage) return 'unavailable';

  const entries = output.split(/^\s*ApplicationExitInfo\s+#\d+:\s*$/mu);
  for (const entry of entries.slice(1)) {
    const pid = Number(entry.match(/\bpid=(\d+)\b/u)?.[1]);
    const process = entry.match(/\bprocess=([^\s]+)/u)?.[1];
    const reason = entry.match(/\breason=(\d+)\s+\(([^)]+)\)/u);
    if (pid !== expectedPid || process !== expectedPackage || !reason) {
      continue;
    }
    return reason[1] === '8' && reason[2]?.trim() === 'PERMISSION CHANGE'
      ? 'permission-change'
      : 'unexpected';
  }
  return 'unavailable';
}

/**
 * Parses runtime permission lines from `dumpsys package` output.
 * Only lines carrying an explicit `granted=` flag are runtime permissions.
 */
export function parseRuntimePermissions(output: string): PermissionState[] {
  const permissions: PermissionState[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(
      /^\s+(android\.permission\.[A-Z_]+): granted=(true|false)/,
    );
    if (!match) continue;
    const name = match[1];
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    permissions.push({ name, granted: match[2] === 'true' });
  }
  return permissions;
}
