import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import net from 'node:net';
import { normalizeProxy, readConfig } from '../config.mjs';
import { discover, portsFromYaml, proxiesFromRegistry } from '../lib/discovery.mjs';
import { probeProxy } from '../lib/probe.mjs';
import { createRelay } from '../lib/relay.mjs';
import { ProxyController } from '../lib/controller.mjs';

test('只接受无凭据的本机 HTTP 代理，拒绝远程、SOCKS、路径和注入', () => {
  assert.equal(normalizeProxy('127.0.0.1:7897'), 'http://127.0.0.1:7897');
  assert.equal(normalizeProxy('http://[::1]:7897'), 'http://[::1]:7897');
  for (const url of ['socks5://127.0.0.1:1080', 'http://example.com:7897', 'http://user:secret@127.0.0.1:7897', 'http://127.0.0.1:7897/x', 'http://127.0.0.1:7897/?x=1', '127.0.0.1:0', '127.0.0.1:65536', '127.0.0.1:7897\r\nHost: evil']) assert.throws(() => normalizeProxy(url), /代理/);
  assert.throws(() => readConfig({ interval: 0 }), /间隔/);
  assert.equal(readConfig({ enabled: { get: () => true } }).enabled, true);
});

test('端口解析不会把 SOCKS、控制接口、嵌套字段或订阅当作代理', () => {
  assert.deepEqual(portsFromYaml('mixed-port: 7897\nport: 7899 # HTTP\nsocks-port: 7898\nexternal-controller: 127.0.0.1:9090\n  port: 8888\nport: 99999\n'), [7897, 7899]);
  assert.deepEqual(proxiesFromRegistry('ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ http=127.0.0.1:7897;https=127.0.0.1:7899;socks=127.0.0.1:7898'), ['http://127.0.0.1:7897', 'http://127.0.0.1:7899']);
  assert.deepEqual(proxiesFromRegistry('ProxyEnable REG_DWORD 0x0\nProxyServer REG_SZ 127.0.0.1:7897'), []);
});

test('自动发现优先 Clash 配置、去重；手动地址不扫描其他候选', async () => {
  const candidates = await discover({ platform: 'test', readFile: async () => 'mixed-port: 7897\nport: 7899\n' });
  assert.deepEqual(candidates.slice(0, 2).map(item => item.url), ['http://127.0.0.1:7897', 'http://127.0.0.1:7899']);
  assert.equal(candidates.filter(item => item.url.endsWith(':7897')).length, 1);
  const manual = await discover({ manualProxy: '127.0.0.1:4444', readFile: () => { throw new Error('不应读取'); } });
  assert.deepEqual(manual, [{ url: 'http://127.0.0.1:4444', source: '手动指定' }]);
});

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
const urlOf = server => `http://127.0.0.1:${server.address().port}`;
const request = (proxy, target = 'http://example.com/') => new Promise((resolve, reject) => {
  const url = new URL(proxy);
  const req = http.get({ hostname: url.hostname, port: url.port, path: target, agent: false }, res => { let body = ''; res.on('data', data => { body += data; }); res.on('end', () => resolve({ status: res.statusCode, body })); });
  req.on('error', reject);
});

test('固定入口切换上游、无代理时拒绝请求、不回退直连', async () => {
  const first = http.createServer((_req, res) => res.end('first'));
  const second = http.createServer((_req, res) => res.end('second'));
  await listen(first); await listen(second);
  const relay = await createRelay();
  try {
    assert.equal((await request(relay.url)).status, 503);
    relay.setUpstream(urlOf(first)); assert.equal((await request(relay.url)).body, 'first');
    relay.setUpstream(urlOf(second)); assert.equal((await request(relay.url)).body, 'second');
    relay.setUpstream(null); assert.equal((await request(relay.url)).status, 503);
  } finally { await relay.close(); await close(first); await close(second); }
});

test('CONNECT 隧道原样转发；切换端口不拆断已建立的连接', async () => {
  const makeProxy = () => http.createServer().on('connect', (_req, socket, head) => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) socket.write(head); socket.pipe(socket); });
  const first = makeProxy(); const second = makeProxy(); await listen(first); await listen(second);
  const relay = await createRelay(); relay.setUpstream(urlOf(first));
  const socket = net.connect(new URL(relay.url).port, '127.0.0.1');
  const next = () => new Promise((resolve, reject) => { socket.once('data', data => resolve(data.toString())); socket.once('error', reject); });
  try {
    const response = next(); socket.write('CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\n'); assert.match(await response, /200/);
    relay.setUpstream(urlOf(second));
    const echoed = next(); socket.write('still connected'); assert.equal(await echoed, 'still connected');
  } finally { socket.destroy(); await relay.close(); await close(first); await close(second); }
});

test('拒绝只开端口、HTTP 错误和非 TLS 服务；检测支持取消', async () => {
  const plain = http.createServer((_req, res) => res.end('not a proxy'));
  await listen(plain);
  try { await assert.rejects(probeProxy(urlOf(plain), { timeout: 300 }), /隧道|CONNECT/); }
  finally { await close(plain); }
  const sockets = new Set();
  const silent = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await listen(silent);
  try {
    await assert.rejects(probeProxy(urlOf(silent), { timeout: 50 }), /超时/);
    const abort = new AbortController(); const pending = probeProxy(urlOf(silent), { signal: abort.signal }); abort.abort(); await assert.rejects(pending, /取消/);
  } finally { for (const socket of sockets) socket.destroy(); await close(silent); }
});

function fixture(extra = {}) {
  const events = []; let current;
  const native = {
    installProxyFromEnvironment: async env => { current = env.get('http_proxy').value; events.push('install'); return async () => { events.push('restore'); current = undefined; }; },
    proxyRouteFor: () => ({ proxied: true, proxy: current }),
    proxyEnvironmentForChild: () => ({ HTTP_PROXY: current, HTTPS_PROXY: current })
  };
  const controller = new ProxyController({ native, discovery: async () => [{ url: 'http://127.0.0.1:7897', source: 'test' }], probe: async () => ({ status: 200 }), relayFactory: async () => ({ url: 'http://127.0.0.1:45678', setUpstream: value => events.push(value), close: async () => events.push('close') }), ...extra });
  return { controller, events };
}

test('运行中开启、修改端口、关闭和卸载恢复原网络策略', async () => {
  const { controller, events } = fixture();
  try {
    await controller.sync({ enabled: true }); await controller.pending;
    assert.equal(controller.snapshot().phase, 'connected');
    await controller.sync({ enabled: true, manualProxy: '127.0.0.1:7899' }); await controller.pending;
    assert.equal(events.filter(item => item === 'install').length, 1);
    await controller.sync({ enabled: false });
    assert.equal(controller.snapshot().phase, 'disabled');
    assert.deepEqual(events.slice(-2), ['restore', 'close']);
  } finally { await controller.dispose(); }
});

test('GitHub 不可达时断开上游，后续自动检测可恢复', async () => {
  let works = false;
  const { controller, events } = fixture({ probe: async () => { if (!works) throw new Error('断网'); return { status: 200 }; } });
  try {
    await controller.sync({ enabled: true }); await controller.pending;
    assert.equal(controller.snapshot().phase, 'offline'); assert.equal(events.at(-1), undefined);
    works = true; await controller.refresh(); assert.equal(controller.snapshot().phase, 'connected');
  } finally { await controller.dispose(); }
});

test('关闭时取消未完成检测，不会在后台重新连接或泄漏原生策略', async () => {
  const { controller, events } = fixture({ probe: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancel')), { once: true })) });
  await controller.sync({ enabled: true });
  await new Promise(resolve => setImmediate(resolve));
  await controller.sync({ enabled: false });
  assert.equal(controller.snapshot().phase, 'disabled');
  assert.equal(events.filter(item => item === 'restore').length, 1);
  await controller.dispose();
});

test('拒绝重复实例；配置错误或原生策略未生效时不宣称连接成功', async () => {
  const first = fixture(); const second = fixture();
  try {
    await first.controller.sync({ enabled: true }); await first.controller.pending;
    await second.controller.sync({ enabled: true }); assert.equal(second.controller.snapshot().phase, 'error');
    await first.controller.sync({ enabled: true, manualProxy: 'socks5://127.0.0.1:7898' }); assert.equal(first.controller.snapshot().phase, 'error');
    assert.ok(first.events.includes('restore'));
  } finally { await first.controller.dispose(); await second.controller.dispose(); }
  const bad = fixture({ native: { installProxyFromEnvironment: async () => async () => {}, proxyRouteFor: () => ({ proxied: false }) } });
  try { await bad.controller.sync({ enabled: true }); assert.equal(bad.controller.snapshot().phase, 'error'); }
  finally { await bad.controller.dispose(); }
});
