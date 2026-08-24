'use strict';

/* global module */

function readPackage(pkg) {
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
  ]) {
    const dependencies = pkg[field];
    if (!dependencies) continue;
    for (const [name, requested] of Object.entries(dependencies)) {
      const isMetroPackage = name === 'metro' || name.startsWith('metro-');
      if (isMetroPackage && requested === '0.84.4') {
        dependencies[name] = '0.84.5';
      }
      if (
        name === 'uuid' &&
        (requested === '7.0.3' || requested === '^7.0.3')
      ) {
        dependencies[name] = '11.1.1';
      }
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
