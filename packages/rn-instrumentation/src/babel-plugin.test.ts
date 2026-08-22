import { createRequire } from 'node:module';
import { transformSync, type PluginItem } from '@babel/core';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plugin = require('../babel-plugin.cjs') as PluginItem;

describe('interaction Babel instrumentation', () => {
  it('injects a source-derived testID and wraps onPress automatically', () => {
    const result = transformSync(
      `export const Screen = () => <Pressable onPress={() => save()}>Save</Pressable>;`,
      {
        filename: 'C:\\app\\src\\Screen.tsx',
        parserOpts: { plugins: ['jsx', 'typescript'] },
        plugins: [[plugin, { projectRoot: 'C:\\app' }]],
        configFile: false,
        babelrc: false,
      },
    );
    expect(result?.code).toContain('observeInteraction');
    expect(result?.code).toContain('testID="rnobs-');
    expect(result?.code).toContain(
      'from "@rn-agent-observer/rn-instrumentation"',
    );
  });

  it('keeps an explicit testID as the stable runtime identity', () => {
    const result = transformSync(
      `const x = <Button testID="save" onPress={save} />;`,
      {
        filename: 'C:\\app\\App.tsx',
        parserOpts: { plugins: ['jsx', 'typescript'] },
        plugins: [[plugin, { projectRoot: 'C:\\app' }]],
        configFile: false,
        babelrc: false,
      },
    );
    expect(result?.code).toContain('elementId: "save"');
    expect(result?.code?.match(/testID/g)).toHaveLength(1);
  });

  it('uses a dynamic testID expression without injecting a duplicate prop', () => {
    const result = transformSync(
      `const x = <Pressable testID={ready ? 'ready' : 'waiting'} onPress={save} />;`,
      {
        filename: 'C:\\app\\App.tsx',
        parserOpts: { plugins: ['jsx', 'typescript'] },
        plugins: [[plugin, { projectRoot: 'C:\\app' }]],
        configFile: false,
        babelrc: false,
      },
    );
    expect(result?.code?.match(/testID=/g)).toHaveLength(1);
    expect(result?.code).toContain("testId: ready ? 'ready' : 'waiting'");
    expect(result?.code).toContain('elementId: "App.tsx:1:11"');
  });
});
