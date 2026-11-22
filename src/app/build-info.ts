import type { BuildInfo } from '../ui/settings/about-section.tsx';

/** What the build stamped (vite.config.ts → tools/build-defines.ts); the only reader of those constants. */
export const buildInfo: BuildInfo = { version: __APP_VERSION__, commit: __APP_COMMIT__ };
