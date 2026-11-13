import assert from 'node:assert/strict';

/** Explicit opt-in only; never loads .env or chooses a fallback database. */
export function disposableDatabaseUrl(env: NodeJS.ProcessEnv, exactDatabase?: string): string {
  assert.equal(
    env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'],
    '1',
    'Explicit disposable opt-in required',
  );
  const value = env['DATABASE_URL'];
  assert.ok(value, 'Explicit DATABASE_URL required; this runner never loads .env');
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL URL required');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Loopback host required');
  if (exactDatabase !== undefined) {
    assert.equal(url.pathname, `/${exactDatabase}`, 'Dedicated disposable database required');
  } else {
    assert.match(decodeURIComponent(url.pathname.slice(1)), /^hktutor[_-].*[_-]test$/);
  }
  assert.equal(url.search, '', 'URL options are not accepted');
  assert.equal(url.hash, '', 'URL fragments are not accepted');
  return value;
}
