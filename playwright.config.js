import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: process.env.PLAYWRIGHT_BASE_URL ? 120000 : 45000,
  expect: { timeout: process.env.PLAYWRIGHT_BASE_URL ? 30000 : 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3101',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 1000 },
  },
  webServer:
    process.env.NOTION_TEST_SERVER || process.env.PLAYWRIGHT_BASE_URL
      ? undefined
      : {
          command: 'node server/index.js --production',
          url: 'http://127.0.0.1:3101',
          reuseExistingServer: false,
          timeout: 30000,
          env: { DATABASE_URL: '', PORT: '3101', DATABASE_PATH: './test-results/browser.sqlite' },
        },
});
