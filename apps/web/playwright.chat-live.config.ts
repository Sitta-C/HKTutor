import { defineConfig, devices } from '@playwright/test';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY !== '1') {
  throw new Error('Live chat tests require an explicitly opted-in disposable database');
}
const database = new URL(databaseUrl);
if (
  !['postgres:', 'postgresql:'].includes(database.protocol) ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) ||
  !/^\/hktutor[-_].*[-_]test$/.test(database.pathname) ||
  database.search ||
  database.hash
) {
  throw new Error('Live chat tests refuse shared/remote databases and schema overrides');
}

const origin = 'http://127.0.0.1:3102';
const api = 'http://127.0.0.1:3301';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'conversations-live.spec.ts',
  outputDir: 'test-results-chat-live',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL: origin, trace: 'off', screenshot: 'only-on-failure' },
  projects: [{ name: 'chat-live-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @hktutor/api start:prod',
      cwd: '../..',
      url: `${api}/api/v1/health`,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'test',
        PORT: '3301',
        WEB_ORIGIN: origin,
        APP_URL: origin,
        COOKIE_SECURE: 'false',
        COOKIE_DOMAIN: '',
        JWT_ACCESS_TTL_SECONDS: '20',
        JWT_ACCESS_SECRET: 'chat-browser-synthetic-access-secret-2026',
        JWT_REFRESH_SECRET: 'chat-browser-synthetic-refresh-secret-2026',
        RESEND_API_KEY: 're_test_placeholder',
        EMAIL_FROM: 'Chat <chat@example.invalid>',
        SUPABASE_URL: 'https://example.invalid',
        SUPABASE_SECRET_KEY: 'sb_secret_browser_test',
        SUPABASE_AVATAR_BUCKET: 'browser-avatar-test',
        SUPABASE_DOCUMENT_BUCKET: 'browser-doc-test',
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
        CHAT_PROXY_PORT: '3102',
        WEB_INTERNAL_URL: 'http://127.0.0.1:3100',
        API_INTERNAL_URL: api,
      },
    },
  ],
});
