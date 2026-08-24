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
