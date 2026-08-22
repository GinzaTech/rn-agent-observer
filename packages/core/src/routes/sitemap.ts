import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';

const ROUTE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/**
 * Derives an expo-router sitemap from the `app/` directory layout.
 * Route groups `(name)` and private `_files` follow expo-router conventions.
 */
export function expoRouterSitemap(projectRoot: string): string[] {
  const appDir = join(projectRoot, 'app');
  if (!existsSync(appDir)) return [];
  const routes = new Set<string>(['/']);
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const extension = extname(entry);
      if (!ROUTE_EXTENSIONS.has(extension)) continue;
      const base = entry.slice(0, -extension.length);
      if (base.startsWith('_')) continue;
      const relativeDir = relative(appDir, dirname(full));
      const segments = relativeDir
        .split(/[\\/]/)
        .filter((segment) => segment && !/^\(.*\)$/.test(segment));
      if (base !== 'index') segments.push(...base.split('/'));
      routes.add(`/${segments.join('/')}`);
    }
  };
  walk(appDir);
  return [...routes].sort();
}

export function hasAppDir(projectRoot: string): boolean {
  return existsSync(join(projectRoot, 'app'));
}
