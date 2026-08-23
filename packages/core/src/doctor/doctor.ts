import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  loadObserverConfig,
  resolveArtifactRoot,
  type LoadedObserverConfig,
} from '../config/observer-config.js';
import { readExpoConfig } from '../config.js';

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail';
export type DoctorOverallStatus = 'ready' | 'degraded' | 'blocked';

export interface DoctorCheck {
  id: string;
  status: DoctorCheckStatus;
  message: string;
  suggestion?: string;
  evidence?: string;
}

export interface DoctorCapabilities {
  projectType: 'expo' | 'bare-react-native' | 'unknown';
  adb: boolean;
  device: boolean;
  metro: boolean;
  instrumentation: boolean;
  securityMode: 'read-only' | 'authorized-active';
}

export interface DoctorReport {
  timestamp: string;
  projectRoot: string;
  overall: DoctorOverallStatus;
  checks: DoctorCheck[];
  capabilities: DoctorCapabilities;
  config: {
    path: string;
    exists: boolean;
    schemaVersion: number;
  };
}

export interface CommandProbeResult {
  ok: boolean;
  stdout: string;
  stderr?: string;
  reason?: string;
}

export interface MetroProbeResult {
  ok: boolean;
  status?: number;
  reason?: string;
}

export interface DoctorProbes {
  nodeVersion: string;
  runCommand(command: string, args: readonly string[]): CommandProbeResult;
  probeMetro(url: string): Promise<MetroProbeResult>;
}

export interface DoctorOptions {
  projectRoot?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  probes?: DoctorProbes;
  checkMetro?: boolean;
}

interface PackageFile {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface AdbDeviceRow {
  id: string;
  state: string;
}

function parseVersion(value: string): [number, number, number] | null {
  const match = /v?(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return Number.isFinite(major) &&
    Number.isFinite(minor) &&
    Number.isFinite(patch)
    ? [major, minor, patch]
    : null;
}

function versionAtLeast(
  actual: [number, number, number],
  required: [number, number, number],
): boolean {
  for (let index = 0; index < actual.length; index += 1) {
    const actualPart = actual[index] ?? 0;
    const requiredPart = required[index] ?? 0;
    if (actualPart > requiredPart) return true;
    if (actualPart < requiredPart) return false;
  }
  return true;
}

function readPackageFile(projectRoot: string): PackageFile | null {
  try {
    const value = JSON.parse(
      readFileSync(join(projectRoot, 'package.json'), 'utf8'),
    ) as unknown;
    return typeof value === 'object' && value !== null
      ? (value as PackageFile)
      : null;
  } catch {
    return null;
  }
}

function dependencyVersion(
  packageFile: PackageFile | null,
  dependency: string,
): string | null {
  return (
    packageFile?.dependencies?.[dependency] ??
    packageFile?.devDependencies?.[dependency] ??
    null
  );
}

function detectProjectType(
  projectRoot: string,
  packageFile: PackageFile | null,
): DoctorCapabilities['projectType'] {
  if (
    readExpoConfig(projectRoot)?.expo ||
    dependencyVersion(packageFile, 'expo')
  ) {
    return 'expo';
  }
  if (
    dependencyVersion(packageFile, 'react-native') ||
    existsSync(join(projectRoot, 'android'))
  ) {
    return 'bare-react-native';
  }
  return 'unknown';
}

export function parseAdbDevices(output: string): AdbDeviceRow[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith('List of devices') &&
        !line.startsWith('* daemon'),
    )
    .map((line) => {
      const [id = '', state = 'unknown'] = line.split(/\s+/);
      return { id, state };
    })
    .filter((row) => row.id.length > 0);
}

export function defaultDoctorProbes(): DoctorProbes {
  return {
    nodeVersion: process.version,
    runCommand(command, args) {
      const result = spawnSync(command, [...args], {
        encoding: 'utf8',
        timeout: 5_000,
        windowsHide: true,
        shell: false,
      });
      if (result.error) {
        return {
          ok: false,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          reason: result.error.message,
        };
      }
      return {
        ok: result.status === 0,
        stdout: result.stdout ?? '',
        ...(result.stderr ? { stderr: result.stderr } : {}),
        ...(result.status === 0
          ? {}
          : { reason: `Command exited with status ${String(result.status)}` }),
      };
    },
    async probeMetro(url) {
      try {
        const statusUrl = new URL('/status', url);
        const response = await fetch(statusUrl, {
          signal: AbortSignal.timeout(1_500),
        });
        return { ok: response.ok, status: response.status };
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function check(
  id: string,
  status: DoctorCheckStatus,
  message: string,
  options: { suggestion?: string; evidence?: string } = {},
): DoctorCheck {
  return { id, status, message, ...options };
}

function overallStatus(checks: readonly DoctorCheck[]): DoctorOverallStatus {
  if (checks.some((entry) => entry.status === 'fail')) return 'blocked';
  if (checks.some((entry) => entry.status === 'warn')) return 'degraded';
  return 'ready';
}

export async function runDoctor(
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const environment = options.environment ?? process.env;
  const probes = options.probes ?? defaultDoctorProbes();
  const checks: DoctorCheck[] = [];

  const nodeVersion = parseVersion(probes.nodeVersion);
  if (!nodeVersion || !versionAtLeast(nodeVersion, [22, 12, 0])) {
    checks.push(
      check(
        'node-version',
        'fail',
        `Node ${probes.nodeVersion} is unsupported`,
        {
          suggestion: 'Install Node.js 22.12 or newer',
        },
      ),
    );
  } else {
    checks.push(
      check('node-version', 'pass', `Node ${probes.nodeVersion} is supported`),
    );
  }

  const packageFile = readPackageFile(projectRoot);
  const projectType = detectProjectType(projectRoot, packageFile);
  if (!existsSync(projectRoot) || !packageFile) {
    checks.push(
      check('project', 'fail', 'Target project does not contain package.json', {
        suggestion: 'Set RN_OBSERVER_PROJECT_ROOT to a React Native project',
      }),
    );
  } else if (projectType === 'unknown') {
    checks.push(
      check('project', 'warn', 'Could not identify Expo or bare React Native', {
        suggestion:
          'Verify the target package dependencies and android project',
      }),
    );
  } else {
    checks.push(check('project', 'pass', `Detected ${projectType} project`));
  }

  let loadedConfig: LoadedObserverConfig;
  try {
    loadedConfig = loadObserverConfig(projectRoot);
    checks.push(
      check(
        'config',
        loadedConfig.exists ? 'pass' : 'warn',
        loadedConfig.exists
          ? 'Validated .rn-observer.json'
          : 'Using safe defaults; project config is not initialized',
        loadedConfig.exists
          ? {}
          : {
              suggestion: 'Run rn-observe init --dry-run, then rn-observe init',
            },
      ),
    );
  } catch (error) {
    const fallbackPath = join(projectRoot, '.rn-observer.json');
    checks.push(
      check('config', 'fail', 'Project observer config is invalid', {
        evidence: error instanceof Error ? error.message : String(error),
        suggestion: `Fix or remove ${fallbackPath}`,
      }),
    );
    loadedConfig = {
      ...loadObserverConfig(join(projectRoot, '__missing-config-fallback__')),
      path: fallbackPath,
    };
  }

  try {
    resolveArtifactRoot(projectRoot, loadedConfig.config);
    checks.push(
      check('artifact-root', 'pass', 'Artifact root stays inside project root'),
    );
  } catch (error) {
    checks.push(
      check('artifact-root', 'fail', 'Artifact root escapes the project', {
        evidence: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  const expoConfig = readExpoConfig(projectRoot);
  const appId =
    loadedConfig.config.target.appId ??
    environment.RN_OBSERVER_APP_ID ??
    expoConfig?.expo?.android?.package;
  if (appId) {
    checks.push(check('app-id', 'pass', `Resolved Android app ID ${appId}`));
  } else {
    checks.push(
      check('app-id', 'warn', 'Android app ID is not configured', {
        suggestion:
          'Set target.appId, RN_OBSERVER_APP_ID, or expo.android.package',
      }),
    );
  }

  const adbExecutable = environment.RN_OBSERVER_ADB ?? 'adb';
  const adbVersion = probes.runCommand(adbExecutable, ['version']);
  const adbAvailable = adbVersion.ok;
  if (!adbAvailable) {
    const adbEvidence = adbVersion.reason ?? adbVersion.stderr;
    checks.push(
      check('adb', 'fail', 'ADB is not available', {
        ...(adbEvidence ? { evidence: adbEvidence } : {}),
        suggestion: 'Install Android Platform Tools and add adb to PATH',
      }),
    );
  } else {
    checks.push(check('adb', 'pass', 'ADB command is available'));
  }

  let deviceAvailable = false;
  if (adbAvailable) {
    const deviceResult = probes.runCommand(adbExecutable, ['devices']);
    const devices = deviceResult.ok ? parseAdbDevices(deviceResult.stdout) : [];
    const ready = devices.filter((device) => device.state === 'device');
    const selectedDevice =
      loadedConfig.config.target.deviceId ?? environment.RN_OBSERVER_DEVICE_ID;
    deviceAvailable = selectedDevice
      ? ready.some((device) => device.id === selectedDevice)
      : ready.length === 1;
    if (selectedDevice && !deviceAvailable) {
      checks.push(
        check(
          'device',
          'fail',
          `Selected device ${selectedDevice} is not ready`,
          {
            suggestion: 'Connect/authorize it or update target.deviceId',
          },
        ),
      );
    } else if (!selectedDevice && ready.length > 1) {
      checks.push(
        check(
          'device',
          'warn',
          'Multiple ready devices require an explicit ID',
          {
            evidence: ready.map((device) => device.id).join(', '),
            suggestion: 'Set target.deviceId or RN_OBSERVER_DEVICE_ID',
          },
        ),
      );
    } else if (deviceAvailable) {
      checks.push(check('device', 'pass', 'One Android device is ready'));
    } else {
      checks.push(
        check('device', 'warn', 'No ready Android device is connected', {
          suggestion: 'Start an emulator or authorize a physical device',
        }),
      );
    }
  }

  const reactNativeVersion = dependencyVersion(packageFile, 'react-native');
  const expoVersion = dependencyVersion(packageFile, 'expo');
  checks.push(
    reactNativeVersion
      ? check('react-native', 'pass', `React Native ${reactNativeVersion}`)
      : check(
          'react-native',
          'warn',
          'React Native dependency was not detected',
        ),
  );
  if (projectType === 'expo') {
    checks.push(
      expoVersion
        ? check('expo', 'pass', `Expo ${expoVersion}`)
        : check(
            'expo',
            'warn',
            'Expo project config exists without dependency',
          ),
    );
  }

  const instrumentation = Boolean(
    dependencyVersion(packageFile, '@rn-agent-observer/rn-instrumentation'),
  );
  if (loadedConfig.config.target.mode === 'enhanced' && !instrumentation) {
    checks.push(
      check(
        'instrumentation',
        'fail',
        'Enhanced mode requires @rn-agent-observer/rn-instrumentation',
        {
          suggestion:
            'Install instrumentation or use zero-instrumentation mode',
        },
      ),
    );
  } else {
    checks.push(
      check(
        'instrumentation',
        instrumentation ? 'pass' : 'warn',
        instrumentation
          ? 'Development instrumentation dependency is present'
          : 'Running with device/CDP evidence only',
      ),
    );
  }

  const metroUrl =
    environment.RN_OBSERVER_METRO_URL ?? loadedConfig.config.target.metroUrl;
  let metroAvailable = false;
  if (options.checkMetro === false) {
    checks.push(check('metro', 'warn', 'Metro reachability check was skipped'));
  } else {
    const metro = await probes.probeMetro(metroUrl);
    metroAvailable = metro.ok;
    checks.push(
      metro.ok
        ? check('metro', 'pass', `Metro is reachable at ${metroUrl}`)
        : check('metro', 'warn', `Metro is not reachable at ${metroUrl}`, {
            ...(metro.reason ? { evidence: metro.reason } : {}),
            suggestion:
              'Start Metro for the target app and configure adb reverse if needed',
          }),
    );
  }

  if (loadedConfig.config.security.mode === 'read-only') {
    checks.push(
      check('security-policy', 'pass', 'Security actions default to read-only'),
    );
  } else {
    checks.push(
      check(
        'security-policy',
        'warn',
        `Authorized active testing is enabled for ${loadedConfig.config.security.allowedAppIds.join(', ')}`,
        {
          suggestion:
            'Keep allowlists narrow and use development fixtures only',
        },
      ),
    );
  }

  return {
    timestamp: new Date().toISOString(),
    projectRoot,
    overall: overallStatus(checks),
    checks,
    capabilities: {
      projectType,
      adb: adbAvailable,
      device: deviceAvailable,
      metro: metroAvailable,
      instrumentation,
      securityMode: loadedConfig.config.security.mode,
    },
    config: {
      path: loadedConfig.path,
      exists: loadedConfig.exists,
      schemaVersion: loadedConfig.config.schemaVersion,
    },
  };
}
