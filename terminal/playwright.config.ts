import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/site.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: 'list',
  outputDir: './test-results',
  use: {
    browserName: 'chromium',
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:4317',
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    headless: true,
    reducedMotion: 'no-preference',
    screenshot: 'only-on-failure',
  },
  // The supervising agent owns the existing server. Never start a webServer here.
});
