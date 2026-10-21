import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discover } from '../lib/discovery.mjs';
import { ProxyController } from '../lib/controller.mjs';

const missingFile = async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };

test('配置候选不会被注册表 EPERM/EACCES 丢弃，且停止后续辅助扫描', async () => {
  for (const code of ['EPERM', 'EACCES']) {
    const warnings = []; let calls = 0;
    const candidates = await discover({ platform: 'win32', readFile: async () => 'mixed-port: 7897\n', run: async () => { calls++; throw Object.assign(new Error('denied'), { code }); }, onWarning: message => warnings.push(message) });
    assert.deepEqual(candidates, [{ url: 'http://127.0.0.1:7897', source: 'Clash Verge 配置' }]);
    assert.equal(calls, 1); assert.equal(warnings.length, 1);
  }
});

test('PowerShell 权限失败保留已启用的系统代理候选', async () => {
  const warnings = [];
  const candidates = await discover({ platform: 'win32', readFile: missingFile,
    run: async program => { if (program === 'reg.exe') return { stdout: 'ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ 127.0.0.1:7897' }; throw Object.assign(new Error('denied'), { code: 'EPERM' }); },
    onWarning: message => warnings.push(message) });
  assert.equal(candidates[0].url, 'http://127.0.0.1:7897'); assert.equal(warnings.length, 1);
});

test('没有候选且辅助读取拒绝时返回空结果和提示，不绕过权限', async () => {
  const warnings = []; let calls = 0;
  const candidates = await discover({ platform: 'win32', readFile: missingFile, run: async () => { calls++; throw Object.assign(new Error('denied'), { code: 'EPERM' }); }, onWarning: message => warnings.push(message) });
  assert.deepEqual(candidates, []); assert.equal(calls, 1); assert.equal(warnings.length, 1);
});

test('辅助超时不丢配置候选；后续配置读取失败也保留已有候选', async () => {
  const warnings = [];
  const candidates = await discover({ platform: 'win32', readFile: async () => 'mixed-port: 7897\n', run: async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); }, onWarning: message => warnings.push(message) });
  assert.equal(candidates.length, 1); assert.equal(warnings.length, 2);
  let reads = 0, scans = 0;
  const partial = await discover({ platform: 'win32', readFile: async () => { if (++reads === 1) return 'mixed-port: 7897\n'; throw Object.assign(new Error('denied'), { code: 'EPERM' }); }, run: async () => { scans++; }, onWarning: () => {} });
  assert.equal(partial[0].url, 'http://127.0.0.1:7897'); assert.equal(reads, 2); assert.equal(scans, 0);
});

function fixture(discovery) {
  let entry;
  return new ProxyController({ native: {
    installProxyFromEnvironment: async env => { entry = env.get('http_proxy').value; return async () => {}; },
    proxyRouteFor: () => ({ proxied: true, proxy: entry }), proxyEnvironmentForChild: () => ({})
  }, discovery, probe: async () => ({ status: 200 }), relayFactory: async () => ({ url: 'http://127.0.0.1:45678', setUpstream() {}, close: async () => {} }) });
}

test('关闭状态连续同步不重建状态或重复执行 stop，启用后关闭仍清理一次', async () => {
  const controller = fixture(async () => []);
  let stops = 0;
  const stop = controller.stop.bind(controller);
  controller.stop = async () => { stops++; return stop(); };
  try {
    const initial = controller.state;
    for (let i = 0; i < 10; i++) await controller.sync({ enabled: false });
    assert.equal(stops, 0); assert.equal(controller.state, initial);
    await controller.sync({ enabled: true }); await controller.pending;
    await controller.sync({ enabled: false }); const disabled = controller.state;
    await controller.sync({ enabled: false });
    assert.equal(stops, 1); assert.equal(controller.state, disabled);
  } finally { await controller.dispose(); }
});

test('候选保留后控制器仍能连接，辅助失败提示恢复后清除', async () => {
  let denied = true;
  const controller = fixture(async options => {
    if (denied) options.onWarning('辅助读取失败');
    return [{ url: 'http://127.0.0.1:7897', source: 'Clash Verge 配置' }];
  });
  try {
    await controller.sync({ enabled: true }); await controller.pending;
    assert.equal(controller.snapshot().phase, 'connected'); assert.deepEqual(controller.snapshot().warnings, ['辅助读取失败']);
    denied = false; await controller.refresh();
    assert.equal(controller.snapshot().phase, 'connected'); assert.deepEqual(controller.snapshot().warnings, []);
  } finally { await controller.dispose(); }
});
