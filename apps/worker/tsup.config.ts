import { defineConfig } from 'tsup';
import { serviceBundleConfig } from '../../tsup.base.js';

/** See apps/api/tsup.config.ts — workspace source is bundled, npm deps stay external. */
export default defineConfig(serviceBundleConfig());
