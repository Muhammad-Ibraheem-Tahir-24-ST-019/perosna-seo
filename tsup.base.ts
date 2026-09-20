import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Options } from 'tsup';

/**
 * Shared bundler configuration for the deployable Node services.
 *
 * The rule is: bundle our own TypeScript, never bundle anything from npm.
 *
 * That second half is easy to get wrong. tsup decides what to externalise from
 * the *entry* package's dependencies, but our workspace packages are bundled in,
 * and their dependencies are not listed in the app's package.json. So
 * `@prisma/client` (pulled in by @indexpilot/db) and `dotenv` (pulled in by
 * @indexpilot/config) were being inlined into an ESM bundle, where their
 * CommonJS `require` and `__dirname` do not exist — the build succeeded and the
 * service then died on its first line at runtime.
 *
 * Collecting the externals from every workspace package fixes that for good,
 * and keeps working when someone adds a dependency later.
 */

const ROOT = dirname(fileURLToPath(import.meta.url));

function dependenciesOf(packageJsonPath: string): string[] {
  try {
    const raw = readFileSync(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { dependencies?: Record<string, string> };
    return Object.keys(parsed.dependencies ?? {});
  } catch {
    return [];
  }
}

/** Every runtime dependency declared anywhere in the workspace. */
function workspaceRuntimeDependencies(): string[] {
  const names = new Set<string>();

  for (const group of ['packages', 'apps']) {
    const groupDir = join(ROOT, group);
    let entries: string[];
    try {
      entries = readdirSync(groupDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      for (const dependency of dependenciesOf(join(groupDir, entry, 'package.json'))) {
        // Workspace packages are the one thing we *do* bundle.
        if (dependency.startsWith('@indexpilot/')) continue;
        names.add(dependency);
      }
    }
  }

  return [...names];
}

export function serviceBundleConfig(): Options {
  return {
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    clean: true,
    splitting: false,
    sourcemap: true,
    noExternal: [/^@indexpilot\//],
    external: [
      ...workspaceRuntimeDependencies(),
      // Prisma's generated client is required through this path at runtime and
      // is not a declared dependency of anything.
      '.prisma/client',
      /^\.prisma\//,
    ],
    /*
     * Bundled CommonJS dependencies still expect `require` to exist. esbuild
     * replaces it with a shim that throws in ESM output; defining a real one
     * makes that shim defer to it.
     */
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  };
}
