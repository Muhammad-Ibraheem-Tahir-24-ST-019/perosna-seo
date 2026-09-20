import { defineConfig } from 'tsup';
import { serviceBundleConfig } from '../../tsup.base.js';

/**
 * Workspace packages ship TypeScript source, so they are bundled into the
 * output. Everything from npm — including @prisma/client and its engines —
 * stays external and is installed normally in the deployment image.
 *
 * See tsup.base.ts for why the externals are collected across the whole
 * workspace rather than taken from this package's dependencies alone.
 */
export default defineConfig(serviceBundleConfig());
