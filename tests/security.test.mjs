import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import net from 'node:net';
import { createRelay } from '../lib/relay.mjs';
import { discover } from '../lib/discovery.mjs';
import { ProxyController } from '../lib/controller.mjs';

async function serverFixture(onConnect) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {});
    onConnect(socket);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  } };
}

function tunnel(proxy, authority = 'github.com:443', headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(proxy);
    const req = http.request({ hostname: url.hostname, port: url.port, method: 'CONNECT', path: authority, headers, agent: false });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('测试等待握手结果超时')); }, 2000);
    req.on('connect', (res, socket) => { clearTimeout(timer); socket.destroy(); resolve(res.statusCode); });
    req.on('error', error => { clearTimeout(timer); reject(error); });
    req.end();
  });
}

function httpRequest(proxy, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port: new URL(proxy).port, path: 'http://example.com/resource', headers, agent: false }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body, aborted: false }));
      res.on('error', () => resolve({ status: res.statusCode, aborted: true }));
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('HTTP 转发未及时结束')); }, 2000);
    req.once('close', () => clearTimeout(timer));
    req.on('error', reject);
  });
}

test('HTTP 响应中途断开时下游立即失败，不能持续等待或误报完整响应', async () => {
  const upstream = await serverFixture(socket => socket.once('data', () => {
    socket.write('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial');
    setTimeout(() => socket.destroy(), 20);
  }));
  const relay = await createRelay(); relay.setUpstream(upstream.url);
  try { assert.equal((await httpRequest(relay.url)).aborted, true); }
  finally { await relay.close(); await upstream.close(); }
});

test('HTTP 静默和慢速响应头均在绝对截止时间内返回 504', async () => {
  for (const trickle of [false, true]) {
    const upstream = await serverFixture(socket => {
      if (!trickle) return;
      socket.write('HTTP/1.1 200 OK\r\nX-Slow: ');
      const timer = setInterval(() => socket.write('H'), 10);
      socket.once('close', () => clearInterval(timer));
    });
    const relay = await createRelay({ responseTimeout: 80 }); relay.setUpstream(upstream.url);
    try { assert.equal((await httpRequest(relay.url)).status, 504); }
    finally { await relay.close(); await upstream.close(); }
  }
});

test('HTTP 转发过滤双方逐跳头和代理凭据，并使用目标 Host', async () => {
  let received;
  const upstream = http.createServer((req, res) => {
    received = req.headers;
    res.writeHead(200, { connection: 'close, x-private', 'x-private': 'hidden', 'x-public': 'visible' }); res.end('ok');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const relay = await createRelay(); relay.setUpstream(`http://127.0.0.1:${upstream.address().port}`);
  try {
    const result = await httpRequest(relay.url, { host: 'incorrect.example', connection: 'close, x-private', 'x-private': 'hidden', 'proxy-authorization': 'Basic secret', 'x-public': 'visible' });
    assert.equal(result.body, 'ok'); assert.equal(received.host, 'example.com');
    assert.equal(received['x-private'], undefined); assert.equal(received['proxy-authorization'], undefined); assert.equal(received['x-public'], 'visible');
    assert.equal(result.headers['x-private'], undefined); assert.equal(result.headers['x-public'], 'visible');
  } finally { await relay.close(); await new Promise(resolve => upstream.close(resolve)); }
});

test('HTTP 不支持的升级响应返回 502，断连不会留下挂起请求', async () => {
  const upstream = await serverFixture(socket => socket.once('data', () => socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')));
  const relay = await createRelay(); relay.setUpstream(upstream.url);
  try { assert.equal((await httpRequest(relay.url)).status, 502); }
  finally { await relay.close(); await upstream.close(); }
});

test('HTTP 下游取消会关闭正在传输的上游连接', async () => {
  let opened;
  const accepted = new Promise(resolve => { opened = resolve; });
  const upstream = await serverFixture(socket => socket.once('data', () => {
    socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\ndata\r\n');
    opened(socket);
  }));
  const relay = await createRelay(); relay.setUpstream(upstream.url);
  let req;
  try {
    const ready = new Promise(resolve => {
      req = http.get({ hostname: '127.0.0.1', port: new URL(relay.url).port, path: 'http://example.com/', agent: false }, res => { res.on('error', () => {}); res.once('data', resolve); });
      req.on('error', () => {});
    });
    const socket = await accepted;
    const closed = new Promise(resolve => socket.once('close', resolve));
    await ready; req.destroy();
    await Promise.race([closed, new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('上游连接未随下游取消关闭')), 1000); timer.unref(); })]);
    assert.equal(socket.destroyed, true);
  } finally { req?.destroy(); await relay.close(); await upstream.close(); }
});

test('插件卸载会关闭未结束的 HTTP 响应和上游连接', async () => {
  const upstream = await serverFixture(socket => socket.once('data', () => {
    socket.write('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial');
  }));
  const relay = await createRelay(); relay.setUpstream(upstream.url);
  let req;
  try {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const result = new Promise((resolve, reject) => {
      req = http.get({ hostname: '127.0.0.1', port: new URL(relay.url).port, path: 'http://example.com/', agent: false }, res => {
        res.once('data', started); res.on('error', () => resolve('aborted')); res.on('end', () => resolve('complete'));
      });
      req.on('error', reject);
    });
    await ready; await relay.close(); assert.equal(await result, 'aborted');
  } finally { req?.destroy(); await relay.close(); await upstream.close(); }
});

test('拒绝入口自循环，包括 localhost 和 IPv6 别名', async () => {
  const relay = await createRelay();
  const port = new URL(relay.url).port;
  try {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) assert.throws(() => relay.setUpstream(`http://${host}:${port}`), /转发入口/);
  } finally { await relay.close(); }
});

test('没有可信来源时不探测任何常用端口', async () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  assert.deepEqual(await discover({ platform: 'test', readFile: async () => { throw missing; } }), []);
  const candidates = await discover({ platform: 'win32', readFile: async () => { throw missing; }, run: async () => ({ stdout: '' }) });
  assert.deepEqual(candidates, []);
});

test('读取权限被拒绝时中止发现，不继续扫描', async () => {
  let queries = 0;
  await assert.rejects(discover({ platform: 'win32', readFile: async () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); }, run: async () => { queries++; return { stdout: '' }; } }), /权限/);
  assert.equal(queries, 0);
});

test('CONNECT 上游静默时在截止时间内返回 504', async () => {
  const upstream = await serverFixture(socket => socket.on('data', () => {}));
  const relay = await createRelay({ handshakeTimeout: 80 }); relay.setUpstream(upstream.url);
  try { assert.equal(await tunnel(relay.url), 504); }
  finally { await relay.close(); await upstream.close(); }
});

test('CONNECT 上游缓慢发送响应头也不能延长截止时间', async () => {
  const upstream = await serverFixture(socket => {
    socket.write('HTTP/1.1 200 Connection Established\r\nX-Slow: ');
    const timer = setInterval(() => socket.write('H'), 10);
    socket.once('close', () => clearInterval(timer));
  });
  const relay = await createRelay({ handshakeTimeout: 80 }); relay.setUpstream(upstream.url);
  try { assert.equal(await tunnel(relay.url), 504); }
  finally { await relay.close(); await upstream.close(); }
});

test('CONNECT 无效响应和上游拒绝不会报告成功', async () => {
  for (const [reply, expected] of [['invalid\r\n\r\n', 502], ['HTTP/1.1 407 Auth Required\r\n\r\n', 407]]) {
    const upstream = await serverFixture(socket => socket.once('data', () => socket.write(reply)));
    const relay = await createRelay(); relay.setUpstream(upstream.url);
    try { assert.equal(await tunnel(relay.url), expected); }
    finally { await relay.close(); await upstream.close(); }
  }
});

test('拒绝浏览器 Origin 请求和无效目标端口', async () => {
  let hits = 0;
  const upstream = await serverFixture(socket => { hits++; socket.destroy(); });
  const relay = await createRelay(); relay.setUpstream(upstream.url);
  try {
    assert.equal(await tunnel(relay.url, 'github.com:443', { Origin: 'https://evil.example' }), 403);
    assert.equal(await tunnel(relay.url, 'github.com:0'), 400);
    assert.equal(await tunnel(relay.url, 'github.com:65536'), 400);
    assert.equal(hits, 0);
  } finally { await relay.close(); await upstream.close(); }
});

test('控制器在探测前过滤自己的入口，不选择回环上游', async () => {
  let probes = 0, entry;
  const controller = new ProxyController({
    native: {
      installProxyFromEnvironment: async env => { entry = env.get('http_proxy').value; return async () => {}; },
      proxyRouteFor: () => ({ proxied: true, proxy: entry }), proxyEnvironmentForChild: () => ({})
    },
    discovery: async () => [{ url: entry, source: '手动指定' }],
    probe: async () => { probes++; return { status: 200 }; }
  });
  try {
    await controller.sync({ enabled: true }); await controller.pending;
    assert.equal(controller.snapshot().phase, 'offline'); assert.equal(probes, 0);
  } finally { await controller.dispose(); }
});
