import { defineConfig, devices } from '@playwright/test';

const databaseUrl = process.env.DATABASE_URL;
const accessSecret = process.env.HKTUTOR_E11_DEMO_ACCESS_SECRET;
const refreshSecret = process.env.HKTUTOR_E11_DEMO_REFRESH_SECRET;
if (
  !databaseUrl ||
  process.env.HKTUTOR_E11_DEMO_TARGET !== 'development' ||
  !process.env.HKTUTOR_E11_DEMO_RUN_ID ||
  !accessSecret ||
  !refreshSecret
) {
  throw new Error(
    'Run pnpm test:demo:playwright to load the development environment and temporary fixtures',
  );
}

const origin = 'http://127.0.0.1:3112';
const api = 'http://127.0.0.1:3311';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'identity-demo-live.spec.ts',
  outputDir: 'test-results/e11-demo',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/e11-demo', open: 'never' }],
    ['json', { outputFile: 'test-results/e11-demo-results.json' }],
  ],
  // Record the viewport only; traces/HAR would also capture credential-bearing auth responses.
  use: {
    baseURL: origin,
    viewport: { width: 1280, height: 720 },
    launchOptions: { slowMo: 200 },
    trace: 'off',
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    screenshot: 'off',
  },
  projects: [{ name: 'e11-demo-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @hktutor/api start:prod',
      cwd: '../..',
      url: `${api}/api/v1/health`,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'test',
        PORT: '3311',
        WEB_ORIGIN: origin,
        APP_URL: origin,
        COOKIE_SECURE: 'false',
        COOKIE_DOMAIN: '',
        JWT_ACCESS_TTL_SECONDS: '900',
        JWT_ACCESS_SECRET: accessSecret,
        JWT_REFRESH_SECRET: refreshSecret,
        RESEND_API_KEY: 're_test_placeholder',
        EMAIL_FROM: 'E11 Demo <demo@example.invalid>',
        SUPABASE_URL: 'https://example.invalid',
        SUPABASE_SECRET_KEY: 'sb_secret_e11_demo_test',
        SUPABASE_AVATAR_BUCKET: 'e11-demo-avatar-test',
        SUPABASE_DOCUMENT_BUCKET: 'e11-demo-document-test',
        OMISE_SECRET_KEY: '',
        OMISE_WEBHOOK_SECRET: '',
      },
    },
    {
      command: 'node ../../scripts/start-chat-browser-web.mjs',
      url: 'http://127.0.0.1:3100',
      reuseExistingServer: false,
    },
    {
      command: 'node ../../scripts/chat-proxy.mjs',
      url: `${origin}/api/v1/health`,
      reuseExistingServer: false,
      env: {
        CHAT_PROXY_PORT: '3112',
        WEB_INTERNAL_URL: 'http://127.0.0.1:3100',
        API_INTERNAL_URL: api,
      },
    },
  ],
});
