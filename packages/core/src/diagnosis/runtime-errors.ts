import type { LogEntry } from '@rn-agent-observer/schemas';

/**
 * React Native can emit non-fatal ReactHost soft exceptions while the Activity
 * window is being attached or focused. Preserve those lines as platform evidence,
 * but do not count them as causal application errors without a fatal entry or an
 * independently actionable message.
 */
export function isNonActionablePlatformLog(entry: LogEntry): boolean {
  if (entry.level === 'fatal') return false;
  const sourceAndMessage = `${entry.source} ${entry.message}`;
  return (
    /\bReactHost\b/i.test(sourceAndMessage) &&
    /(?:Unhandled SoftException|ReactNoCrashSoftException|onWindowFocusChange)/i.test(
      sourceAndMessage,
    )
  );
}

export interface RuntimeErrorLogPartition {
  actionable: LogEntry[];
  platformWarnings: LogEntry[];
  continuations: LogEntry[];
}

const isStackContinuation = (message: string): boolean =>
  /^\s*(?:ReactHost(?:\{\d+\})?:\s*)?(?:at\s|Caused by:|Suppressed:|\.\.\.\s+\d+\s+more\b)/i.test(
    message,
  );

/**
 * Logcat emits one row per Java stack line. Partition an ordered window so a
 * single ReactHost soft exception is not inflated into many application errors.
 * Orphan stack continuations remain preserved separately but are not treated as
 * independent causal errors.
 */
export function partitionRuntimeErrorLogs(
  entries: readonly LogEntry[],
): RuntimeErrorLogPartition {
  const partition: RuntimeErrorLogPartition = {
    actionable: [],
    platformWarnings: [],
    continuations: [],
  };
  let softExceptionSource: string | null = null;

  for (const entry of entries) {
    if (entry.level !== 'error' && entry.level !== 'fatal') continue;
    if (isNonActionablePlatformLog(entry)) {
      partition.platformWarnings.push(entry);
      softExceptionSource = entry.source;
      continue;
    }
    if (isStackContinuation(entry.message)) {
      if (softExceptionSource === entry.source) {
        partition.platformWarnings.push(entry);
      } else {
        partition.continuations.push(entry);
        softExceptionSource = null;
      }
      continue;
    }
    partition.actionable.push(entry);
    softExceptionSource = null;
  }

  return partition;
}
