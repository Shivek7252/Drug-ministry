const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  outputDir: './test-results/playwright',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'test-results/playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    channel: 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'set PORT=3100&& set BROWSER=none&& set REACT_APP_BACKEND_ORIGIN=http://127.0.0.1:5101&& npm.cmd start',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: true,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    { name: 'desktop-edge', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-edge', use: { ...devices['Pixel 7'], channel: 'msedge' } },
  ],
});
