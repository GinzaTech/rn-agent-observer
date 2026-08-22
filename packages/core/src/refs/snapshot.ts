import { randomUUID } from 'node:crypto';
import type { UIElement, UITree } from '@rn-agent-observer/schemas';
import { flattenUiTree } from '../adb/parsers.js';

export type SnapshotKind =
  'button' | 'text' | 'text-field' | 'switch' | 'link' | 'other';

export interface SnapshotBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapshotElement {
  ref: string;
  kind: SnapshotKind;
  label: string;
  value: string | null;
  testId: string | null;
  interactive: boolean;
  visible: boolean;
  bounds: SnapshotBounds | null;
}

export interface UiSnapshot {
  snapshotId: string;
  timestamp: string;
  source: string;
  elements: SnapshotElement[];
}

export function elementKind(element: UIElement): SnapshotKind {
  const type = element.type ?? '';
  if (type.includes('EditText')) return 'text-field';
  if (type.includes('Switch')) return 'switch';
  if (type.includes('Button') || type.includes('ImageButton')) return 'button';
  if (element.clickable && type.includes('Text')) return 'link';
  if (type.includes('Text')) return 'text';
  return 'other';
}

function isInteractive(element: UIElement): boolean {
  return (element.clickable ?? false) || (element.focusable ?? false);
}

export function buildSnapshot(
  tree: UITree,
  options: { interactiveOnly?: boolean } = {},
): UiSnapshot {
  const flat = flattenUiTree(tree.roots).filter(
    (element) => element.visible !== false,
  );
  const selected = flat.filter((element) =>
    options.interactiveOnly
      ? isInteractive(element)
      : isInteractive(element) || Boolean(element.text),
  );
  const elements: SnapshotElement[] = selected.map((element, index) => ({
    ref: `e${index + 1}`,
    kind: elementKind(element),
    label:
      element.contentDescription ?? element.text ?? element.id ?? element.type,
    value: element.text ?? null,
    testId: element.id ?? null,
    interactive: isInteractive(element),
    visible: element.visible ?? true,
    bounds: element.bounds ?? null,
  }));
  return {
    snapshotId: randomUUID(),
    timestamp: tree.timestamp,
    source: tree.source,
    elements,
  };
}

export function snapshotIdentityKeys(elements: SnapshotElement[]): string[] {
  const counters = new Map<string, number>();
  return elements.map((element) => {
    let base: string;
    if (element.testId) {
      base = `id:${element.testId}`;
    } else if (element.value !== null && element.label === element.value) {
      // Pure text nodes key by ordinal within their kind so that a value
      // change surfaces as "changed" instead of removed+added.
      base = `seq:${element.kind}`;
    } else if (element.label) {
      base = `label:${element.kind}:${element.label}`;
    } else if (element.bounds) {
      base = `pos:${Math.round(element.bounds.x)},${Math.round(element.bounds.y)}`;
    } else {
      base = `kind:${element.kind}`;
    }
    const ordinal = (counters.get(base) ?? 0) + 1;
    counters.set(base, ordinal);
    return `${base}#${ordinal}`;
  });
}

export interface SnapshotRefRegistry {
  identities: Record<string, string>;
  nextRef: number;
}

export function stabilizeSnapshotRefs(
  snapshot: UiSnapshot,
  previous?: SnapshotRefRegistry,
): { snapshot: UiSnapshot; registry: SnapshotRefRegistry } {
  const identities = { ...(previous?.identities ?? {}) };
  let nextRef = previous?.nextRef ?? 1;
  const keys = snapshotIdentityKeys(snapshot.elements);
  const elements = snapshot.elements.map((element, index) => {
    const key = keys[index];
    if (!key) return element;
    const ref = identities[key] ?? `e${nextRef++}`;
    identities[key] = ref;
    return { ...element, ref };
  });
  return {
    snapshot: { ...snapshot, elements },
    registry: { identities, nextRef },
  };
}

function moved(a: SnapshotElement, b: SnapshotElement): boolean {
  if (!a.bounds || !b.bounds) return false;
  const dx = Math.abs(a.bounds.x - b.bounds.x);
  const dy = Math.abs(a.bounds.y - b.bounds.y);
  return dx > 8 || dy > 8;
}

export interface SnapshotDiffEntry {
  ref: string;
  kind: SnapshotKind;
  label: string;
}

export interface SnapshotDiff {
  added: SnapshotDiffEntry[];
  removed: SnapshotDiffEntry[];
  changed: Array<SnapshotDiffEntry & { from: string; to: string }>;
  lines: string[];
}

export function snapshotDiff(
  before: UiSnapshot,
  after: UiSnapshot,
): SnapshotDiff {
  const beforeKeys = snapshotIdentityKeys(before.elements);
  const afterKeys = snapshotIdentityKeys(after.elements);
  const beforeMap = new Map(
    before.elements.map((element, index) => [beforeKeys[index], element]),
  );
  const afterMap = new Map(
    after.elements.map((element, index) => [afterKeys[index], element]),
  );
  const toEntry = (element: SnapshotElement): SnapshotDiffEntry => ({
    ref: element.ref,
    kind: element.kind,
    label: element.label,
  });
  const added = after.elements
    .filter((_, index) => !beforeMap.has(afterKeys[index] ?? ''))
    .map(toEntry);
  const removed = before.elements
    .filter((_, index) => !afterMap.has(beforeKeys[index] ?? ''))
    .map(toEntry);
  const changed = after.elements
    .map((element, index) => ({
      element,
      prior: beforeMap.get(afterKeys[index] ?? ''),
    }))
    .filter(
      (entry): entry is { element: SnapshotElement; prior: SnapshotElement } =>
        entry.prior !== undefined &&
        (entry.prior.value !== entry.element.value ||
          moved(entry.prior, entry.element)),
    )
    .map((entry) => ({
      ...toEntry(entry.element),
      from: entry.prior.value ?? '',
      to: entry.element.value ?? '',
    }));
  const lines = [
    ...added.map((entry) => `+ @${entry.ref} [${entry.kind}] "${entry.label}"`),
    ...removed.map(
      (entry) => `- @${entry.ref} [${entry.kind}] "${entry.label}"`,
    ),
    ...changed.map(
      (entry) =>
        `= @${entry.ref} [${entry.kind}] "${entry.label}" ${entry.from} -> ${entry.to}`,
    ),
  ];
  return { added, removed, changed, lines };
}
