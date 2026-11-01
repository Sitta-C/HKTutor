import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Match the repository's standalone production output; never share the active dev server's port.
const web = fileURLToPath(new URL('../apps/web/', import.meta.url));
const standalone = path.join(web, '.next/standalone/apps/web');
await mkdir(path.join(standalone, '.next'), { recursive: true });
await cp(path.join(web, '.next/static'), path.join(standalone, '.next/static'), {
  recursive: true,
});
if (existsSync(path.join(web, 'public'))) {
  await cp(path.join(web, 'public'), path.join(standalone, 'public'), { recursive: true });
}
const server = spawn(process.execPath, [path.join(standalone, 'server.js')], {
  env: { ...process.env, PORT: '3100', HOSTNAME: '127.0.0.1' },
  stdio: 'inherit',
});
server.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
process.on('SIGINT', () => server.kill('SIGINT'));
process.on('SIGTERM', () => server.kill('SIGTERM'));
