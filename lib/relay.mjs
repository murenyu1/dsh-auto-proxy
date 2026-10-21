import http from 'node:http';
import { normalizeProxy } from '../config.mjs';

export async function createRelay({ handshakeTimeout = 10_000 } = {}) {
  let upstream;
  const sockets = new Set();
  const track = socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {}); return socket; };
  const server = http.createServer((req, res) => {
    if (req.headers.origin) { res.writeHead(403); res.end(); return; }
    const current = upstream;
    if (!current) { res.writeHead(503); res.end('Proxy unavailable'); return; }
    // HTTP clients send absolute URLs; never act as a local control/API server.
    let target;
    try { target = new URL(req.url); if (target.protocol !== 'http:') throw new Error(); }
    catch { res.writeHead(400); res.end(); return; }
    const headers = { ...req.headers }; delete headers['proxy-authorization']; delete headers['proxy-connection'];
    const out = http.request({ hostname: current.hostname.replace(/^\[|\]$/g, ''), port: current.port, method: req.method, path: req.url, headers, agent: false }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    out.on('socket', track);
    out.setTimeout(30_000, () => out.destroy());
    out.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on('close', () => out.destroy());
    req.pipe(out);
  });
  server.maxHeadersCount = 100;
  server.maxConnections = 128;
  server.headersTimeout = 10_000;
  server.on('connection', track);
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('connect', (req, client, head) => {
    if (req.headers.origin) { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const current = upstream;
    if (!current) { client.end('HTTP/1.1 503 Proxy unavailable\r\nConnection: close\r\n\r\n'); return; }
    const authority = /^(?:[a-z0-9.-]+|\[[a-f0-9:]+\]):(\d{1,5})$/i.exec(req.url);
    if (!authority || Number(authority[1]) < 1 || Number(authority[1]) > 65535) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    let remote, finished = false;
    const connect = http.request({ hostname: current.hostname.replace(/^\[|\]$/g, ''), port: Number(current.port), method: 'CONNECT', path: req.url, agent: false });
    connect.on('socket', track);
    const fail = (code = 502) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      connect.destroy(); remote?.destroy();
      if (!client.destroyed) client.end(`HTTP/1.1 ${code} Proxy connection failed\r\nConnection: close\r\n\r\n`);
    };
    // Absolute deadline: covers TCP connect, silent upstream and trickled response headers.
    const timer = setTimeout(() => fail(504), handshakeTimeout);
    connect.on('error', () => fail());
    connect.on('response', response => { response.resume(); fail(502); });
    connect.on('connect', (response, socket, upstreamHead) => {
      remote = socket;
      if (finished || client.destroyed) { remote.destroy(); return; }
      if (response.statusCode !== 200) { fail(response.statusCode >= 400 && response.statusCode <= 599 ? response.statusCode : 502); return; }
      finished = true; clearTimeout(timer);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (upstreamHead.length) client.write(upstreamHead);
      if (head.length) remote.write(head);
      remote.once('error', () => client.destroy());
      remote.once('close', () => client.destroy());
      client.pipe(remote); remote.pipe(client);
    });
    client.once('close', () => { clearTimeout(timer); finished = true; connect.destroy(); remote?.destroy(); });
    connect.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  server.on('error', () => {});
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    setUpstream(value) {
      const candidate = value ? new URL(normalizeProxy(value)) : undefined;
      // All accepted endpoints are loopback. Reject the port across localhost/IPv6 aliases.
      if (candidate && Number(candidate.port) === server.address()?.port) throw new Error('不能将本插件的转发入口设为代理上游。');
      upstream = candidate;
    },
    async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
  };
}
