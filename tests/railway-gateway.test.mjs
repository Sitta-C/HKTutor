import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

const docker = (...args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr || result.error}`);
  return result.stdout.trim();
};

// Synthetic upstreams only: no application environment, credentials or database access.
const upstream = `
  const http = require('node:http');
  const [identity, port] = process.argv.slice(1);
  const server = http.createServer((request, response) => {
    let bytes = 0;
    request.on('data', (chunk) => { bytes += chunk.length; });
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Set-Cookie', 'demo_refresh=synthetic; Path=/; HttpOnly; Secure; SameSite=Lax');
      response.end(JSON.stringify({ identity, url: request.url, headers: request.headers, bytes }));
    });
  });
  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => {});
    socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n'
      + 'X-Upstream-Host: ' + request.headers.host + '\\r\\n'
      + 'X-Upstream-Origin: ' + request.headers.origin + '\\r\\n'
      + 'X-Upstream-Path: ' + request.url + '\\r\\n\\r\\n');
    if (head.length) socket.write(head);
    socket.pipe(socket);
  });
  server.listen({ port: Number(port), host: '::', ipv6Only: true });
`;

test(
  'Railway gateway routes HTTP and Upgrade on an IPv6-only private network',
  { skip: process.env.HKTUTOR_TEST_RAILWAY_GATEWAY !== '1', timeout: 180_000 },
  async (t) => {
    const id = `hktutor-railway-test-${process.pid}`;
    const network = id;
    const gateway = `${id}-gateway`;
    const api = `${id}-api`;
    const web = `${id}-web`;
    const image = 'hktutor-railway-gateway:local';
    const nodeImage = 'node:24.19.0-bookworm-slim';
    const containers = [gateway, api, web];

    docker('image', 'inspect', image);
    docker('image', 'inspect', nodeImage);
    docker('network', 'create', '--ipv6', '--ipv4=false', network);
    t.after(() => {
      for (const container of containers) {
        spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8' });
      }
      spawnSync('docker', ['network', 'rm', network], { encoding: 'utf8' });
    });

    const startUpstream = (name, alias, identity, port) =>
      docker(
        'run',
        '-d',
        '--name',
        name,
        '--network',
        network,
        '--network-alias',
        alias,
        nodeImage,
        'node',
        '-e',
        upstream,
        identity,
        port,
      );
    const client = (code) => docker('exec', web, 'node', '--input-type=module', '-e', code);
    const waitForIdentity = async (pathname, identity) => {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const result = spawnSync(
          'docker',
          [
            'exec',
            web,
            'node',
            '-e',
            `fetch('http://gateway:9090${pathname}').then(r => r.json()).then(body => {
              if (body.identity !== '${identity}') process.exitCode = 1;
            }).catch(() => { process.exitCode = 1; });`,
          ],
          { encoding: 'utf8', timeout: 10_000 },
        );
        if (result.status === 0) {
          return;
        }
        await setTimeout(1000);
      }
      assert.fail(`Gateway did not reach ${identity}: ${docker('logs', gateway)}`);
    };

    startUpstream(web, 'web', 'web', '3000');
    // The API has no DNS record yet. Gateway startup must not depend on it resolving.
    docker(
      'run',
      '-d',
      '--name',
      gateway,
      '--network',
      network,
      '--network-alias',
      'gateway',
      '-e',
      'PORT=9090',
      '-e',
      'API_INTERNAL_URL=http://api:3001',
      '-e',
      'WEB_INTERNAL_URL=http://web:3000',
      '-e',
      'request_uri=must-not-replace-nginx-variable',
      image,
    );
    await waitForIdentity('/', 'web');
    docker('exec', gateway, 'nginx', '-t');
    client(`
      import assert from 'node:assert/strict';
      const response = await fetch('http://gateway:9090/api/v1/health');
      assert.equal(response.status, 502);
    `);

    startUpstream(api, 'api', 'api-v1', '3001');
    await waitForIdentity('/api/v1/health', 'api-v1');

    client(`
      import assert from 'node:assert/strict';
      import http from 'node:http';
      const origin = 'https://demo.example.test';
      const headers = { Origin: origin, 'X-Forwarded-Proto': 'https' };
      for (const [path, identity] of [
        ['/?lang=th', 'web'],
        ['/dashboard/messages', 'web'],
        ['/api/v1/conversations/a%2Fb/messages?cursor=c%2Bd&limit=2', 'api-v1'],
        ['/api/v1/socket.io/?EIO=4&transport=polling', 'api-v1'],
      ]) {
        const response = await fetch('http://gateway:9090' + path, { headers });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('set-cookie'),
          'demo_refresh=synthetic; Path=/; HttpOnly; Secure; SameSite=Lax');
        const body = await response.json();
        assert.equal(body.identity, identity);
        assert.equal(body.url, path);
        assert.equal(body.headers.host, 'gateway:9090');
        assert.equal(body.headers.origin, origin);
        assert.equal(body.headers['x-forwarded-host'], 'gateway:9090');
        assert.equal(body.headers['x-forwarded-proto'], 'https');
      }
      const payload = 'x'.repeat(5 * 1024 * 1024);
      const upload = await fetch('http://gateway:9090/api/v1/documents', {
        method: 'POST', headers, body: payload,
      });
      assert.equal(upload.status, 200);
      assert.equal((await upload.json()).bytes, payload.length);
      const oversized = await fetch('http://gateway:9090/api/v1/documents', {
        method: 'POST', body: 'x'.repeat(6 * 1024 * 1024 + 1),
      });
      assert.equal(oversized.status, 413);
      await new Promise((resolve, reject) => {
        const request = http.request('http://gateway:9090/api/v1/socket.io/?EIO=4&transport=websocket', {
          headers: { ...headers, Host: 'demo.example.test', Connection: 'Upgrade', Upgrade: 'websocket' },
        });
        request.on('error', reject);
        request.on('response', (response) => reject(new Error('Expected 101, got ' + response.statusCode)));
        request.on('upgrade', (response, socket) => {
          const timeout = setTimeout(() => { socket.destroy(); reject(new Error('Upgrade echo timed out')); }, 5000);
          assert.equal(response.statusCode, 101);
          assert.equal(response.headers['x-upstream-host'], 'demo.example.test');
          assert.equal(response.headers['x-upstream-origin'], origin);
          assert.equal(response.headers['x-upstream-path'], '/api/v1/socket.io/?EIO=4&transport=websocket');
          socket.on('error', reject);
          socket.once('data', (data) => {
            clearTimeout(timeout);
            socket.destroy();
            try { assert.equal(data.toString(), 'synthetic-upgrade-echo'); resolve(); }
            catch (error) { reject(error); }
          });
          socket.write('synthetic-upgrade-echo');
        });
        request.end();
      });
    `);

    const previousAddress = docker(
      'inspect',
      '-f',
      '{{range .NetworkSettings.Networks}}{{.GlobalIPv6Address}}{{end}}',
      api,
    );
    docker('rm', '-f', api);
    // Occupy its old IP to ensure the replacement actually receives a different address.
    const blocker = `${id}-old-address`;
    containers.push(blocker);
    docker(
      'run',
      '-d',
      '--name',
      blocker,
      '--network',
      network,
      '--ip6',
      previousAddress,
      nodeImage,
      'node',
      '-e',
      'setInterval(() => {}, 1000)',
    );
    startUpstream(api, 'api', 'api-v2', '3001');
    const nextAddress = docker(
      'inspect',
      '-f',
      '{{range .NetworkSettings.Networks}}{{.GlobalIPv6Address}}{{end}}',
      api,
    );
    assert.notEqual(nextAddress, previousAddress);
    await waitForIdentity('/api/v1/health', 'api-v2');

    const logs = docker('logs', gateway);
    assert.doesNotMatch(logs, /cursor=c%2Bd|limit=2|transport=polling/);
  },
);
