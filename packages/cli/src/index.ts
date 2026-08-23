#!/usr/bin/env node
import { ObserverCore } from '@rn-agent-observer/core';
import { runCli } from './cli.js';

const controller = new AbortController();
const core = new ObserverCore();
const abort = (): void => controller.abort();
process.once('SIGINT', abort);
process.once('SIGTERM', abort);
try {
  const exitCode = await runCli(process.argv.slice(2), undefined, core, {
    signal: controller.signal,
    progress: true,
  });
  process.exitCode = controller.signal.aborted ? 130 : exitCode;
} finally {
  process.removeListener('SIGINT', abort);
  process.removeListener('SIGTERM', abort);
  core.close();
}
