import { describe, expect, it } from 'vitest';
import {
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
} from './parsers.js';

describe('ADB parsers', () => {
  it('parses device inventory', () => {
    expect(
      parseAdbDevices(
        'List of devices attached\nemulator-5554 device product:sdk model:Pixel_8 transport_id:1\n',
      ),
    ).toEqual([
      {
        id: 'emulator-5554',
        platform: 'android',
        state: 'device',
        model: 'Pixel 8',
      },
    ]);
  });

  it('normalizes UI nodes and bounds', () => {
    expect(
      normalizeUiNode({
        class: 'android.widget.Button',
        text: 'Buy now',
        'resource-id': 'dev.demo:id/buy-button',
        bounds: '[32,100][132,160]',
        clickable: 'true',
      }),
    ).toMatchObject({
      id: 'buy-button',
      type: 'Button',
      text: 'Buy now',
      clickable: true,
      bounds: { x: 32, y: 100, width: 100, height: 60 },
    });
  });

  it('parses focused logcat entries', () => {
    expect(
      parseLogcat('1787288000.123 123 456 E ReactNativeJS: boom\n')[0],
    ).toMatchObject({
      level: 'error',
      source: 'ReactNativeJS',
      message: 'boom',
    });
  });

  it('parses frame and memory samples', () => {
    expect(
      parseFrameTimes('Draw\tPrepare\tProcess\tExecute\n1\t2\t3\t4\n'),
    ).toEqual([10]);
    expect(
      parseFrameTimes(
        'Flags,FrameTimelineVsyncId,IntendedVsync,FrameCompleted,\n0,1,1000000,11000000,\n---PROFILEDATA---',
      ),
    ).toEqual([10]);
    expect(parseTotalPssMb('TOTAL 204800 0 0')).toBe(200);
    expect(
      parseTopCpuPercent(
        'PID USER PR NI VIRT RES SHR S[%CPU] %MEM TIME+ ARGS\n123 u0 20 0 1G 1M 1M R 17.5 1.0 0:01 app',
      ),
    ).toBe(17.5);
  });

  it('parses resumed activity from dumpsys output', () => {
    expect(
      parseResumedActivity(
        'mLastFinishedActivity=ActivityRecord{abc u0 other.pkg/.Other t1}\n' +
          '  topResumedActivity=ActivityRecord{43942ea u0 dev.rnagentobserver.demo/.MainActivity t56760}\n',
      ),
    ).toBe('dev.rnagentobserver.demo/.MainActivity');
    expect(
      parseResumedActivity(
        'ResumedActivity: ActivityRecord{46c9611 u0 com.miui.home/.launcher.Launcher t2}',
      ),
    ).toBe('com.miui.home/.launcher.Launcher');
    expect(parseResumedActivity('no activity state available')).toBeNull();
  });

  it('parses /proc/net/dev samples and computes deltas', () => {
    const output = [
      'Inter-|   Receive',
      ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets',
      '    lo: 1000 10 0 0 0 0 0 0 2000 20',
      '  wlan0: 5000 50 0 0 0 0 0 0 3000 30',
      'rmnet_data0: 900 9 0 0 0 0 0 0 100 1',
    ].join('\n');
    const samples = parseProcNetDev(output);
    expect(samples).toEqual([
      { interfaceName: 'wlan0', rxBytes: 5000, txBytes: 3000 },
      { interfaceName: 'rmnet_data0', rxBytes: 900, txBytes: 100 },
    ]);
    const deltas = networkInterfaceDeltas(
      samples,
      parseProcNetDev(
        output
          .replace('wlan0: 5000', 'wlan0: 6000')
          .replace('rmnet_data0: 900', 'rmnet_data0: 900'),
      ),
    );
    expect(deltas).toEqual([
      { interfaceName: 'wlan0', rxBytes: 1000, txBytes: 0 },
      { interfaceName: 'rmnet_data0', rxBytes: 0, txBytes: 0 },
    ]);
  });

  it('parses runtime permissions from dumpsys package output', () => {
    expect(
      parseRuntimePermissions(
        [
          'requested permissions:',
          '  android.permission.INTERNET',
          'runtime permissions:',
          '  android.permission.CAMERA: granted=true, flags=[...]',
          '  android.permission.ACCESS_FINE_LOCATION: granted=false, flags=[...]',
          '  android.permission.CAMERA: granted=true, flags=[...]',
        ].join('\n'),
      ),
    ).toEqual([
      { name: 'android.permission.CAMERA', granted: true },
      { name: 'android.permission.ACCESS_FINE_LOCATION', granted: false },
    ]);
  });

  it('accepts only a matching Android permission-change exit', () => {
    const exitInfo = `
ACTIVITY MANAGER PROCESS EXIT INFO (dumpsys activity exit-info)
  package: dev.rnagentobserver.demo
    Historical Process Exit for uid=10229
        ApplicationExitInfo #0:
          timestamp=2026-08-23 09:36:07.808 pid=5692 realUid=10229
          process=dev.rnagentobserver.demo reason=8 (PERMISSION CHANGE) subreason=0 (UNKNOWN)
`;

    expect(
      parsePermissionChangeExitStatus(
        exitInfo,
        'dev.rnagentobserver.demo',
        5692,
      ),
    ).toBe('permission-change');
    expect(
      parsePermissionChangeExitStatus(
        exitInfo.replace('pid=5692', 'pid=5693'),
        'dev.rnagentobserver.demo',
        5692,
      ),
    ).toBe('unavailable');
    expect(
      parsePermissionChangeExitStatus(
        exitInfo.replace('PERMISSION CHANGE', 'CRASH'),
        'dev.rnagentobserver.demo',
        5692,
      ),
    ).toBe('unexpected');
    expect(
      parsePermissionChangeExitStatus(exitInfo, 'dev.other.demo', 5692),
    ).toBe('unavailable');
  });
});
