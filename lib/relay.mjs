import http from 'node:http';
import { normalizeProxy } from '../config.mjs';

function forwardHeaders(source) {
  const headers = { ...source };
  const connection = String(headers.connection ?? '').split(',').map(value => value.trim().toLowerCase());
  for (const name of [...connection, 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']) delete headers[name];
  return headers;
}

export async function createRelay({ handshakeTimeout = 10_000, responseTimeout = 30_000 } = {}) {
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
    const headers = { ...forwardHeaders(req.headers), host: target.host };
    let response;
    const fail = (code = 502) => {
      clearTimeout(timer);
      out.destroy(); response?.destroy();
      if (res.destroyed || res.writableEnded) return;
      // A truncated body must fail visibly, never look like a complete response.
      if (res.headersSent) res.destroy();
      else { res.writeHead(code, { connection: 'close' }); res.end(); }
    };
    const out = http.request({ hostname: current.hostname.replace(/^\[|\]$/g, ''), port: current.port || 80, method: req.method, path: req.url, headers, agent: false }, incoming => {
      response = incoming; clearTimeout(timer);
      incoming.on('error', () => fail());
      incoming.on('aborted', () => fail());
      res.writeHead(incoming.statusCode, forwardHeaders(incoming.headers)); incoming.pipe(res);
    });
    // Socket inactivity alone does not bound TCP connect or trickled headers.
    const timer = setTimeout(() => fail(504), responseTimeout);
    out.on('socket', track);
    out.setTimeout(responseTimeout, () => fail(504));
    out.on('error', () => fail());
    out.on('upgrade', (_response, socket) => { socket.destroy(); fail(); });
    req.on('aborted', () => fail());
    req.on('error', () => fail());
    res.on('close', () => { clearTimeout(timer); out.destroy(); response?.destroy(); });
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
    const connect = http.request({ hostname: current.hostname.replace(/^\[|\]$/g, ''), port: Number(current.port || 80), method: 'CONNECT', path: req.url, agent: false });
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
