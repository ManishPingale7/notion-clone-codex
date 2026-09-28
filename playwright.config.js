import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3101',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 1000 },
  },
  webServer: process.env.NOTION_TEST_SERVER
    ? undefined
    : {
        command: 'node server/index.js --production',
        url: 'http://127.0.0.1:3101',
        reuseExistingServer: false,
        timeout: 30000,
        env: { PORT: '3101', DATABASE_PATH: './test-results/browser.sqlite' },
      },
});
