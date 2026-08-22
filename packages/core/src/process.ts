import { spawn } from 'node:child_process';

export interface ProcessResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

export async function runProcess(
  command: string,
  args: readonly string[],
  timeoutMs = 30_000,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr).toString('utf8').trim(),
          exitCode: exitCode ?? -1,
        });
      }
    });
  });
}
