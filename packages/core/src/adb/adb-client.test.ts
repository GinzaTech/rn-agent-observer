import { describe, expect, it } from 'vitest';
import { AdbClient } from './adb-client.js';

class CapturingAdbClient extends AdbClient {
  commands: string[][] = [];
  output = 'ok';

  override async run(args: readonly string[]): Promise<Buffer> {
    this.commands.push([...args]);
    return Buffer.from(this.output);
  }
}

describe('AdbClient shell command encoding', () => {
  it('preserves deep-link query delimiters as one remote argument', async () => {
    const client = new CapturingAdbClient('emulator-5554');

    await client.deepLink(
      'dev.rnagentobserver.demo',
      'rnobs-security-demo://security/lab?item=fixture&item=',
    );

    expect(client.commands).toEqual([
      [
        'shell',
        "'am' 'start' '-a' 'android.intent.action.VIEW' '-d' 'rnobs-security-demo://security/lab?item=fixture&item=' '-p' 'dev.rnagentobserver.demo'",
      ],
    ]);
  });

  it('quotes apostrophes and empty remote arguments safely', async () => {
    const client = new CapturingAdbClient('emulator-5554');

    await client.shell(['printf', '%s', "it's", '']);

    expect(client.commands).toEqual([['shell', "'printf' '%s' 'it'\\''s' ''"]]);
  });

  it('reads only the safe matching permission-change exit status', async () => {
    const client = new CapturingAdbClient('emulator-5554');
    client.output = `
  package: dev.rnagentobserver.demo
        ApplicationExitInfo #0:
          timestamp=2026-08-23 09:36:07.808 pid=5692 realUid=10229
          process=dev.rnagentobserver.demo reason=8 (PERMISSION CHANGE) subreason=0 (UNKNOWN)
`;

    await expect(
      client.permissionChangeExitStatus('dev.rnagentobserver.demo', 5692),
    ).resolves.toBe('permission-change');
    expect(client.commands).toEqual([
      ['shell', "'dumpsys' 'activity' 'exit-info' 'dev.rnagentobserver.demo'"],
    ]);
  });
});
