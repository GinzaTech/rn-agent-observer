export type ReplayStep =
  | {
      action: 'tap';
      testId?: string;
      ref?: string;
      x?: number;
      y?: number;
      settleMs?: number;
    }
  | {
      action: 'swipe';
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      durationMs?: number;
    }
  | { action: 'type-text'; text: string }
  | { action: 'back' }
  | { action: 'deep-link'; uri: string }
  | { action: 'reload'; fast?: boolean }
  | { action: 'assert'; testId?: string; text?: string; visible?: boolean }
  | { action: 'wait'; ms: number }
  | { action: 'screenshot' };

export interface ReplayScript {
  name?: string;
  continueOnError?: boolean;
  steps: ReplayStep[];
}

export interface ReplayStepResult {
  index: number;
  action: string;
  ok: boolean;
  summary: string;
}

export interface ReplayReport {
  name: string;
  total: number;
  passed: number;
  failed: number;
  stoppedEarly: boolean;
  results: ReplayStepResult[];
}

export interface ReplayActions {
  tap(step: Extract<ReplayStep, { action: 'tap' }>): Promise<string>;
  swipe(step: Extract<ReplayStep, { action: 'swipe' }>): Promise<string>;
  typeText(step: Extract<ReplayStep, { action: 'type-text' }>): Promise<string>;
  back(): Promise<string>;
  deepLink(step: Extract<ReplayStep, { action: 'deep-link' }>): Promise<string>;
  reload(step: Extract<ReplayStep, { action: 'reload' }>): Promise<string>;
  assert(step: Extract<ReplayStep, { action: 'assert' }>): Promise<string>;
  wait(step: Extract<ReplayStep, { action: 'wait' }>): Promise<string>;
  screenshot(): Promise<string>;
}

/**
 * Executes a replay script step by step against the given action adapter.
 * Stops on the first failure unless continueOnError is set.
 */
export async function runReplayScript(
  script: ReplayScript,
  actions: ReplayActions,
): Promise<ReplayReport> {
  const results: ReplayStepResult[] = [];
  let stoppedEarly = false;
  for (const [index, step] of script.steps.entries()) {
    let ok = true;
    let summary = '';
    try {
      switch (step.action) {
        case 'tap':
          summary = await actions.tap(step);
          break;
        case 'swipe':
          summary = await actions.swipe(step);
          break;
        case 'type-text':
          summary = await actions.typeText(step);
          break;
        case 'back':
          summary = await actions.back();
          break;
        case 'deep-link':
          summary = await actions.deepLink(step);
          break;
        case 'reload':
          summary = await actions.reload(step);
          break;
        case 'assert':
          summary = await actions.assert(step);
          break;
        case 'wait':
          summary = await actions.wait(step);
          break;
        case 'screenshot':
          summary = await actions.screenshot();
          break;
      }
    } catch (error) {
      ok = false;
      summary = error instanceof Error ? error.message : String(error);
    }
    if (step.action === 'assert' && summary.startsWith('FAILED')) {
      ok = false;
    }
    results.push({ index, action: step.action, ok, summary });
    if (!ok && !script.continueOnError) {
      stoppedEarly = true;
      break;
    }
  }
  const executed = results.length;
  return {
    name: script.name ?? 'replay',
    total: script.steps.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    stoppedEarly,
    results: results.slice(0, executed),
  };
}
