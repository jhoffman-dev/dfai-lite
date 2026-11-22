import { defineConfig, devices } from '@playwright/test';

/**
 * WebKit, the engine of the Mac app's webview, runs the tree's drag spec
 * when asked (`E2E_WEBKIT=1 pnpm e2e`, after `pnpm exec playwright install
 * webkit`): CI installs Chromium alone, to stay quick.
 */
const webkit = process.env['E2E_WEBKIT']
  ? [{ name: 'webkit', testMatch: 'folders.spec.ts', use: { ...devices['Desktop Safari'] } }]
  : [];

/** One Chromium project against the built app, served as it ships (`vite preview` over `dist`). */
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? 'line' : 'list',
  use: { baseURL: 'http://localhost:4791', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, ...webkit],
  webServer: {
    command: 'pnpm exec vite preview',
    url: 'http://localhost:4791',
    // Never reuse: a server already on the port may be another worktree's build.
    reuseExistingServer: false,
  },
});
