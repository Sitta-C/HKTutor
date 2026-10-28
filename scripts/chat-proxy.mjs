import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

const SOCKET_PATH = '/api/v1/socket.io';

/** Development same-origin entrypoint; forwards polling and the actual Upgrade tunnel. */
export function createChatProxy({ apiTarget, webTarget }) {
  const api = new URL(apiTarget);
  const web = new URL(webTarget);
  const requestUpstream = (request, target) => {
    const transport = target.protocol === 'https:' ? https : http;
    return transport.request({
      hostname: target.hostname,
      port: target.port,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: request.headers.host ?? target.host },
    });
  };
  const server = http.createServer((request, response) => {
    const target = request.url?.startsWith('/api/v1/') ? api : web;
    const upstream = requestUpstream(request, target);
    upstream.on('response', (result) => {
      response.writeHead(result.statusCode ?? 502, result.headers);
      result.pipe(response);
    });
    upstream.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(502);
      }
      response.end('Upstream unavailable');
    });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });
  const tunnels = new Set();
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname !== SOCKET_PATH && pathname !== `${SOCKET_PATH}/`) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = requestUpstream(request, api);
    upstream.on('upgrade', (response, peer, upstreamHead) => {
      const headers = response.rawHeaders.reduce((lines, value, index, all) => {
        if (index % 2 === 0) {
          lines.push(`${value}: ${all[index + 1]}`);
        }
        return lines;
      }, []);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.join('\r\n')}\r\n\r\n`);
      socket.write(upstreamHead);
      peer.write(head);
      tunnels.add(socket);
      tunnels.add(peer);
      socket.on('error', () => peer.destroy());
      peer.on('error', () => socket.destroy());
      socket.on('close', () => {
        tunnels.delete(socket);
        peer.destroy();
      });
      peer.on('close', () => {
        tunnels.delete(peer);
        socket.destroy();
      });
      socket.pipe(peer).pipe(socket);
    });
    upstream.on('response', () =>
      socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'),
    );
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    upstream.end();
  });
  const shutdown = () => {
    for (const socket of tunnels) {
      socket.destroy();
    }
    server.close();
    server.closeAllConnections();
  };
  return { server, shutdown };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server: proxy, shutdown } = createChatProxy({
    apiTarget: process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001',
    webTarget: process.env.WEB_INTERNAL_URL ?? 'http://127.0.0.1:3000',
  });
  proxy.listen(Number(process.env.CHAT_PROXY_PORT ?? 3002), '127.0.0.1', () => {
    process.stdout.write(`Chat development proxy listening on ${proxy.address().port}\n`);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
