import type {
  RuntimeUiIssue,
  RuntimeUiModel,
  RuntimeUiNode,
  SourceUiElement,
  UiInteractionEvent,
  UIElement,
  UITree,
} from '@rn-agent-observer/schemas';
import { flattenUiTree } from '../adb/parsers.js';
import type { UiElementTelemetry } from '../network/network.js';
import type { SnapshotElement, UiSnapshot } from '../refs/snapshot.js';

export interface BuildRuntimeUiModelInput {
  sourceElements: SourceUiElement[];
  tree: UITree;
  snapshot: UiSnapshot;
  telemetry: UiElementTelemetry[];
  interactions: UiInteractionEvent[];
  route: string | null;
  viewport: { width: number; height: number } | null;
  now?: string;
}

function nativeForSnapshot(
  flat: UIElement[],
  snapshot: SnapshotElement,
): UIElement | undefined {
  if (snapshot.testId) {
    return flat.find(
      (element) =>
        element.id === snapshot.testId ||
        element.resourceId?.endsWith(`/${snapshot.testId}`),
    );
  }
  return flat.find(
    (element) =>
      (element.text ?? element.contentDescription) === snapshot.label &&
      element.bounds?.x === snapshot.bounds?.x &&
      element.bounds?.y === snapshot.bounds?.y,
  );
}

function onScreen(
  bounds: SnapshotElement['bounds'],
  viewport: BuildRuntimeUiModelInput['viewport'],
): boolean | null {
  if (!bounds || !viewport) return null;
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.x < viewport.width &&
    bounds.y < viewport.height &&
    bounds.x + bounds.width > 0 &&
    bounds.y + bounds.height > 0
  );
}

function issue(
  code: RuntimeUiIssue['code'],
  severity: RuntimeUiIssue['severity'],
  description: string,
  suggestion: string,
  source: RuntimeUiIssue['source'] = null,
  refs: string[] = [],
  interactionIds: string[] = [],
): RuntimeUiIssue {
  return {
    code,
    severity,
    description,
    source,
    refs,
    interactionIds,
    suggestion,
  };
}

export function buildRuntimeUiModel(
  input: BuildRuntimeUiModelInput,
): RuntimeUiModel {
  const flat = flattenUiTree(input.tree.roots);
  const nativeActions = input.snapshot.elements.filter(
    (element) => element.interactive,
  );
  const telemetryById = new Map(
    input.telemetry.flatMap((entry) => [
      [entry.elementId, entry] as const,
      ...(entry.testId ? ([[entry.testId, entry]] as const) : []),
    ]),
  );
  const nativeByTestId = new Map(
    nativeActions.flatMap((entry) =>
      entry.testId ? ([[entry.testId, entry]] as const) : [],
    ),
  );
  const matchedNativeRefs = new Set<string>();
  const nodes: RuntimeUiNode[] = [];
  const issues: RuntimeUiIssue[] = [];

  for (const sourceElement of input.sourceElements) {
    const sourceInteraction = [...input.interactions]
      .reverse()
      .find(
        (entry) =>
          entry.elementId === sourceElement.id ||
          entry.elementId === sourceElement.generatedTestId ||
          (sourceElement.testId !== null &&
            entry.testId === sourceElement.testId),
      );
    const effectiveTestId =
      sourceElement.testId ??
      sourceInteraction?.testId ??
      sourceElement.generatedTestId;
    const native = effectiveTestId
      ? nativeByTestId.get(effectiveTestId)
      : undefined;
    if (native) matchedNativeRefs.add(native.ref);
    const telemetry =
      telemetryById.get(sourceElement.id) ??
      (effectiveTestId ? telemetryById.get(effectiveTestId) : undefined);
    const nativeElement = native ? nativeForSnapshot(flat, native) : undefined;
    const enabled =
      nativeElement?.enabled ??
      telemetry?.enabled ??
      (sourceElement.disabledStatic === null
        ? null
        : !sourceElement.disabledStatic);
    const intersects = onScreen(native?.bounds ?? null, input.viewport);
    const rendered: RuntimeUiNode['rendered'] = native
      ? 'yes'
      : telemetry?.mounted === false
        ? 'no'
        : telemetry?.mounted === true
          ? 'yes'
          : 'unknown';
    const visibility: RuntimeUiNode['visibility'] = native
      ? intersects === false
        ? 'offscreen'
        : 'visible'
      : telemetry?.mounted === false
        ? 'unmounted'
        : telemetry?.visible === false
          ? 'hidden'
          : telemetry?.mounted === true
            ? 'flattened-or-unobserved'
            : 'unknown';
    let canPress: RuntimeUiNode['canPress'] = 'unknown';
    let canPressReason =
      'No native or instrumentation evidence proves that this source action is currently hittable.';
    if (enabled === false) {
      canPress = 'no';
      canPressReason = 'The control is disabled.';
    } else if (['offscreen', 'hidden', 'unmounted'].includes(visibility)) {
      canPress = 'no';
      canPressReason = `The control is ${visibility}.`;
    } else if (native?.interactive && visibility === 'visible') {
      canPress = 'yes';
      canPressReason =
        'A visible, enabled native action with matching testID is present; verify the resulting transition after pressing.';
    }
    nodes.push({
      sourceElement,
      ref: native?.ref ?? null,
      testId: effectiveTestId,
      label:
        native?.label ??
        telemetry?.label ??
        sourceElement.label ??
        sourceElement.componentName,
      role: native?.kind ?? telemetry?.role ?? sourceElement.role,
      rendered,
      visibility,
      enabled,
      canPress,
      canPressReason,
      bounds: native?.bounds ?? null,
      instrumented: telemetry !== undefined,
    });
    if (!sourceElement.testId) {
      issues.push(
        issue(
          'source-action-without-testid',
          'warning',
          `${sourceElement.componentName} has no static testID, so an agent cannot correlate source and runtime reliably.`,
          'Add a stable, unique testID to the owning interactive component.',
          sourceElement.source,
        ),
      );
    }
    if (telemetry?.mounted === true && !native) {
      issues.push(
        issue(
          'source-action-not-observed',
          'info',
          'React reports this control mounted, but it is absent from the native accessibility tree.',
          'Check view flattening, accessibility importance, clipping, and conditional layout before trying coordinates.',
          sourceElement.source,
        ),
      );
    }
  }

  for (const native of nativeActions.filter(
    (element) => !matchedNativeRefs.has(element.ref),
  )) {
    const nativeElement = nativeForSnapshot(flat, native);
    const enabled = nativeElement?.enabled ?? null;
    const intersects = onScreen(native.bounds, input.viewport);
    const visibility: RuntimeUiNode['visibility'] =
      intersects === false ? 'offscreen' : 'visible';
    const canPress =
      enabled === false ? 'no' : visibility === 'visible' ? 'yes' : 'no';
    nodes.push({
      sourceElement: null,
      ref: native.ref,
      testId: native.testId,
      label: native.label,
      role: native.kind,
      rendered: 'yes',
      visibility,
      enabled,
      canPress,
      canPressReason:
        enabled === false
          ? 'The native control is disabled.'
          : visibility === 'visible'
            ? 'The native tree exposes this as a visible action, but source ownership is unknown.'
            : 'The native bounds do not intersect the viewport.',
      bounds: native.bounds,
      instrumented: false,
    });
    issues.push(
      issue(
        'native-action-without-source',
        'info',
        `Runtime action "${native.label}" could not be mapped to a static source testID.`,
        'Add/forward a stable testID or instrument the wrapper component with reportUiElement.',
        null,
        [native.ref],
      ),
    );
    if (enabled === false) {
      issues.push(
        issue(
          'disabled-action',
          'info',
          `Runtime action "${native.label}" is visible but disabled.`,
          'Confirm the disabled state is expected and expose the reason in nearby UI text.',
          null,
          [native.ref],
        ),
      );
    }
  }

  for (const interaction of input.interactions.filter(
    (entry) => entry.phase === 'error',
  )) {
    issues.push(
      issue(
        'interaction-error',
        'error',
        `Interaction "${interaction.label ?? interaction.elementId}" threw: ${interaction.error ?? 'unknown error'}.`,
        'Open the owning source location, correlate logs/network state, and replay the same testID after the smallest fix.',
        null,
        [],
        [interaction.interactionId],
      ),
    );
  }

  return {
    timestamp: input.now ?? new Date().toISOString(),
    source: 'typescript-ast+rn-instrumentation+android-uiautomator+logcat',
    availability: { status: 'available', reason: null },
    route: input.route,
    nodes,
    interactions: input.interactions,
    counts: {
      sourceActions: input.sourceElements.length,
      nativeActions: nativeActions.length,
      visible: nodes.filter((node) => node.visibility === 'visible').length,
      pressable: nodes.filter((node) => node.canPress === 'yes').length,
      unknownVisibility: nodes.filter((node) =>
        ['unknown', 'flattened-or-unobserved'].includes(node.visibility),
      ).length,
      interactions: new Set(
        input.interactions.map((entry) => entry.interactionId),
      ).size,
      interactionErrors: input.interactions.filter(
        (entry) => entry.phase === 'error',
      ).length,
    },
    issues,
    artifacts: {
      uiTreeId: input.tree.artifactId ?? '',
      uiTreePath: input.tree.artifactPath ?? '',
    },
    limitations: [
      'canPress=yes is a semantic/native hit candidate, not proof that no overlay intercepts the tap; verify the post-press transition.',
      'Source actions with dynamic testID/labels cannot be statically correlated until reportUiElement supplies runtime identity.',
      'React Native view flattening can make mounted source components absent from the native tree; this is reported, not guessed as hidden.',
      'Only handlers wrapped with observeInteraction can capture physical/user in-app presses; CLI-driven actions are recorded separately by the session.',
      'Instrumentation travels through Android logcat; long/noisy sessions can exceed the ring buffer, so call ui-model after major flows instead of waiting indefinitely.',
    ],
  };
}
