'use strict';
/* global require, module, process */
/* eslint-disable @typescript-eslint/no-require-imports */

const { createHash } = require('node:crypto');
const path = require('node:path');

function generatedTestId(filename, projectRoot, line, column) {
  const relative = path.relative(projectRoot, filename).replaceAll('\\', '/');
  const hash = createHash('sha1')
    .update(`${relative}:${line}:${column}`)
    .digest('hex')
    .slice(0, 10);
  return `rnobs-${hash}`;
}

function sourceIdentity(filename, projectRoot, line, column) {
  const relative = path.relative(projectRoot, filename).replaceAll('\\', '/');
  return `${relative}:${line}:${column}`;
}

module.exports = function rnAgentObserverBabelPlugin({ types: t }) {
  return {
    name: 'rn-agent-observer-interactions',
    visitor: {
      Program: {
        enter(programPath, state) {
          state.rnObserverWrapped = false;
          state.rnObserverProgram = programPath;
        },
        exit(programPath, state) {
          if (!state.rnObserverWrapped) return;
          const existing = programPath.node.body.find(
            (node) =>
              t.isImportDeclaration(node) &&
              node.source.value === '@rn-agent-observer/rn-instrumentation',
          );
          if (existing) {
            const hasSpecifier = existing.specifiers.some(
              (specifier) =>
                t.isImportSpecifier(specifier) &&
                specifier.imported.name === 'observeInteraction',
            );
            if (!hasSpecifier) {
              existing.specifiers.push(
                t.importSpecifier(
                  t.identifier('observeInteraction'),
                  t.identifier('observeInteraction'),
                ),
              );
            }
          } else {
            programPath.unshiftContainer(
              'body',
              t.importDeclaration(
                [
                  t.importSpecifier(
                    t.identifier('observeInteraction'),
                    t.identifier('observeInteraction'),
                  ),
                ],
                t.stringLiteral('@rn-agent-observer/rn-instrumentation'),
              ),
            );
          }
        },
      },
      JSXOpeningElement(openingPath, state) {
        const attributes = openingPath.get('attributes');
        const onPressPath = attributes.find(
          (candidate) =>
            candidate.isJSXAttribute() &&
            candidate.node.name.name === 'onPress',
        );
        if (!onPressPath || !onPressPath.isJSXAttribute()) return;
        const initializer = onPressPath.node.value;
        if (
          !t.isJSXExpressionContainer(initializer) ||
          !initializer.expression ||
          t.isJSXEmptyExpression(initializer.expression)
        ) {
          return;
        }
        if (
          t.isCallExpression(initializer.expression) &&
          t.isIdentifier(initializer.expression.callee, {
            name: 'observeInteraction',
          })
        ) {
          return;
        }
        const filename = state.file.opts.filename;
        const location = openingPath.node.loc && openingPath.node.loc.start;
        if (!filename || !location) return;
        const projectRoot = state.opts.projectRoot || process.cwd();
        const testIdPath = attributes.find(
          (candidate) =>
            candidate.isJSXAttribute() && candidate.node.name.name === 'testID',
        );
        let testId = null;
        let testIdExpression = null;
        if (
          testIdPath &&
          testIdPath.isJSXAttribute() &&
          t.isStringLiteral(testIdPath.node.value)
        ) {
          testId = testIdPath.node.value.value;
          testIdExpression = t.stringLiteral(testId);
        } else if (
          testIdPath &&
          testIdPath.isJSXAttribute() &&
          t.isJSXExpressionContainer(testIdPath.node.value) &&
          testIdPath.node.value.expression &&
          !t.isJSXEmptyExpression(testIdPath.node.value.expression)
        ) {
          testIdExpression = t.cloneNode(
            testIdPath.node.value.expression,
            true,
          );
        }
        if (!testIdExpression) {
          testId = generatedTestId(
            filename,
            projectRoot,
            location.line,
            location.column + 1,
          );
          openingPath.pushContainer(
            'attributes',
            t.jsxAttribute(t.jsxIdentifier('testID'), t.stringLiteral(testId)),
          );
          testIdExpression = t.stringLiteral(testId);
        }
        const tag = openingPath.get('name').toString();
        const elementId = testId
          ? testId
          : sourceIdentity(
              filename,
              projectRoot,
              location.line,
              location.column + 1,
            );
        const metadata = t.objectExpression([
          t.objectProperty(
            t.identifier('elementId'),
            t.stringLiteral(elementId),
          ),
          t.objectProperty(t.identifier('testId'), testIdExpression),
          t.objectProperty(t.identifier('label'), t.stringLiteral(tag)),
        ]);
        initializer.expression = t.callExpression(
          t.identifier('observeInteraction'),
          [metadata, initializer.expression],
        );
        state.rnObserverWrapped = true;
      },
    },
  };
};
