import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initObserverConfig } from '../config/observer-config.js';
import { parseAdbDevices, runDoctor, type DoctorProbes } from './doctor.js';

const temporaryDirectories: string[] = [];

function createExpoProject(
  options: { instrumentation?: boolean } = {},
): string {
  const directory = mkdtempSync(join(tmpdir(), 'rn-observer-doctor-'));
  temporaryDirectories.push(directory);
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      dependencies: {
        expo: '~57.0.0',
        'react-native': '0.86.2',
        ...(options.instrumentation
          ? { '@rn-agent-observer/rn-instrumentation': '2.4.1' }
          : {}),
      },
    }),
  );
  writeFileSync(
    join(directory, 'app.json'),
    JSON.stringify({ expo: { android: { package: 'dev.example.app' } } }),
  );
  return directory;
}

function probes(
  options: {
    nodeVersion?: string;
    adb?: boolean;
    devices?: string;
    metro?: boolean;
  } = {},
): DoctorProbes {
  return {
    nodeVersion: options.nodeVersion ?? 'v22.12.0',
    runCommand(_command, args) {
      if (args[0] === 'version') {
        return options.adb === false
          ? { ok: false, stdout: '', reason: 'not found' }
          : { ok: true, stdout: 'Android Debug Bridge version 1.0.41' };
      }
      return {
        ok: true,
        stdout:
          options.devices ??
          'List of devices attached\nemulator-5554\tdevice\n',
      };
    },
    async probeMetro() {
      return options.metro === false
        ? { ok: false, reason: 'connection refused' }
        : { ok: true, status: 200 };
    },
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('doctor', () => {
  it('parses adb device states without treating unauthorized as ready', () => {
    expect(
      parseAdbDevices(
        'List of devices attached\nemulator-5554\tdevice\nphone\tunauthorized\n',
      ),
    ).toEqual([
      { id: 'emulator-5554', state: 'device' },
      { id: 'phone', state: 'unauthorized' },
    ]);
  });

  it('reports a ready initialized Expo project', async () => {
    const projectRoot = createExpoProject({ instrumentation: true });
    initObserverConfig(projectRoot);

    const report = await runDoctor({
      projectRoot,
      environment: {},
      probes: probes(),
    });

    expect(report.overall).toBe('ready');
    expect(report.capabilities).toMatchObject({
      projectType: 'expo',
      adb: true,
      device: true,
      metro: true,
      instrumentation: true,
      securityMode: 'read-only',
    });
    expect(report.checks.every((entry) => entry.status === 'pass')).toBe(true);
  });

  it('blocks unsupported Node and missing adb', async () => {
    const projectRoot = createExpoProject();

    const report = await runDoctor({
      projectRoot,
      environment: {},
      probes: probes({ nodeVersion: 'v20.18.0', adb: false }),
      checkMetro: false,
    });

    expect(report.overall).toBe('blocked');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'node-version', status: 'fail' }),
        expect.objectContaining({ id: 'adb', status: 'fail' }),
      ]),
    );
  });

  it('reports multiple devices and unavailable Metro as degraded', async () => {
    const projectRoot = createExpoProject();
    initObserverConfig(projectRoot);

    const report = await runDoctor({
      projectRoot,
      environment: {},
      probes: probes({
        devices:
          'List of devices attached\nemulator-5554\tdevice\nphone\tdevice\n',
        metro: false,
      }),
    });

    expect(report.overall).toBe('degraded');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'device', status: 'warn' }),
        expect.objectContaining({ id: 'metro', status: 'warn' }),
      ]),
    );
  });
});
