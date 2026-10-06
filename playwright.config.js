// E2E con Chromium. Levanta un servidor propio con una base temporal (pruebas/e2e/servidor.mjs).
import { defineConfig, devices } from '@playwright/test';

const PUERTO = Number(process.env.PUERTO_E2E || 4317);

export default defineConfig({
  testDir: 'pruebas/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${PUERTO}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node pruebas/e2e/servidor.mjs',
    url: `http://127.0.0.1:${PUERTO}/api/salud`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PUERTO_E2E: String(PUERTO) },
  },
});
