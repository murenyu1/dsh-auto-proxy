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
