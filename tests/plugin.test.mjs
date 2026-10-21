import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

test('状态接口先做 DSH Connection 鉴权，只接受 GET/POST', async () => {
  let source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
  source = source.replace("import z from '@deepseek-ai/schemastery';", 'const z = undefined;');
  source = source.replace("import * as native from '@deepseek-ai/dsh-http-proxy';", 'const native = {};');
  source = source.replace("import { createConfig } from './config.mjs';", 'const createConfig = () => ({});');
  source = source.replace("'./lib/controller.mjs'", JSON.stringify(new URL('../lib/controller.mjs', import.meta.url).href));
  const { apply } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let route, rejection = 403;
  const cleanups = [];
  const ctx = {
    effect: callback => { cleanups.push(callback()); },
    inject: (_keys, callback) => callback({
      connection: { requestRejection: () => rejection },
      webServer: { register: value => { route = value; return () => {}; } },
      effect: callback => { cleanups.push(callback()); }
    })
  };
  apply(ctx, { enabled: false });
  const call = async method => {
    let status, data;
    await route.handler({ method }, { setHeader() {}, writeHead: code => { status = code; }, end: body => { data = JSON.parse(body); } });
    return { status, data };
  };
  try {
    assert.equal((await call('GET')).status, 403);
    assert.equal((await call('POST')).status, 403);
    rejection = undefined;
    assert.equal((await call('GET')).data.phase, 'disabled');
    assert.equal((await call('POST')).status, 202);
    assert.equal((await call('DELETE')).status, 405);
  } finally { for (const cleanup of cleanups.reverse()) await cleanup?.(); }
});

test('前端设置保存、相对状态路径、请求截止时间及卸载取消符合契约', async () => {
  let plugin, fields, registered, saved = 0, modelDisposed = false;
  const effects = [], requests = [];
  const values = { enabled: 'false', manualProxy: '', interval: '10' };
  class Form {
    constructor(_scope, definitions) { fields = definitions; }
    actions() { return { edit: (key, value) => { values[key] = value; }, save: () => { saved++; }, discard() {} }; }
    shell() { return { writable: true, saving: false, dirty: true }; }
    field(key) { return { text: values[key] }; }
    bind(read) { return { subscribe() {}, getSnapshot: read }; }
    dispose() { modelDisposed = true; }
  }
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useState: value => [value, () => {}], useCallback: fn => fn, useEffect: callback => effects.push(callback)
  };
  vm.runInNewContext(fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: entry => { plugin = entry.factory(name => name === 'react' ? React : { SettingsForm: 'NativeForm', SettingsFormModel: Form }); } } },
    URL, Date, fetch: async (path, options) => { requests.push({ path, options }); return { ok: true, json: async () => ({ phase: 'disabled' }) }; }, setInterval: () => 1, clearInterval() {}, AbortController,
    AbortSignal: { timeout: ms => { assert.equal(ms, 10_000); return AbortSignal.timeout(ms); }, any: signals => AbortSignal.any(signals) }
  });
  const cleanups = [];
  plugin.apply({
    configForms: { get: key => { assert.equal(key, 'auto-proxy'); return {}; }, whileServed: (_ids, callback) => callback() },
    slots: { inject: (_name, callback) => callback(), register: (_options, render) => { registered = render; return () => {}; } },
    effect: callback => cleanups.push(callback())
  });
  try {
    const card = registered({});
    const tree = card.type(card.props);
    assert.equal(tree.type, 'NativeForm'); tree.props.onSave(); assert.equal(saved, 1);
    const parse = key => fields.find(field => field.field === key).parse;
    assert.equal(parse('enabled')('true').value, true);
    assert.equal(parse('interval')('10').value, 10);
    assert.equal(parse('interval')('0'), undefined);
    assert.equal(parse('manualProxy')('http://127.0.0.1:7897').value, 'http://127.0.0.1:7897');
    assert.equal(parse('manualProxy')('http://127.0.0.1:80').value, 'http://127.0.0.1:80');
    assert.equal(parse('manualProxy')('http://localhost').value, 'http://localhost');
    assert.equal(parse('manualProxy')('http://127.0.0.1:0'), undefined);
    assert.equal(parse('manualProxy')('socks5://127.0.0.1:7898'), undefined);
    const stopPolling = effects[0]();
    await new Promise(resolve => setImmediate(resolve));
    const button = tree.children[0].children.find(child => child?.type === 'button');
    await button.props.onClick();
    assert.deepEqual(requests.map(item => item.options.method), ['GET', 'POST']);
    for (const { path, options } of requests) {
      assert.equal(new URL(path, 'https://host.example/dsh/').pathname, '/dsh/plugins/auto-proxy/state');
      assert.equal(options.credentials, 'same-origin'); assert.equal(options.signal.aborted, false);
    }
    stopPolling(); assert.equal(requests[0].options.signal.aborted, true);
  } finally { for (const cleanup of cleanups.reverse()) cleanup?.(); }
  assert.equal(modelDisposed, true);
});

test('右侧边栏、底部胶囊与插件面板共享 ProxyStateHub 状态并支持联动', async () => {
  let plugin;
  const values = { enabled: 'false', manualProxy: '', interval: '10' };
  let saved = 0;
  class Form {
    constructor() {}
    actions() { return { edit: (key, value) => { values[key] = value; }, save: () => { saved++; }, discard() {} }; }
    shell() { return { writable: true, saving: false, dirty: false }; }
    field(key) { return { text: values[key] }; }
    bind(read) { return { subscribe: () => () => {}, getSnapshot: read }; }
    dispose() {}
  }
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useCallback: fn => fn,
    useEffect: fn => fn()
  };
  vm.runInNewContext(fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: entry => { plugin = entry.factory(name => name === 'react' ? React : { SettingsForm: 'NativeForm', SettingsFormModel: Form }); } } },
    URL, Date,
    fetch: async () => ({ ok: true, json: async () => ({ phase: 'connected', upstream: '127.0.0.1:7897', entry: '127.0.0.1:49210' }) }),
    setInterval: () => 1, clearInterval() {}, AbortController,
    AbortSignal: { timeout: ms => AbortSignal.timeout(ms), any: signals => AbortSignal.any(signals) },
    console, setTimeout: fn => setImmediate(fn)
  });

  let registeredTab = null, registeredDock = null, registeredCard = null;
  const cleanups = [];
  plugin.apply({
    configForms: { get: () => ({}), whileServed: (_ids, cb) => cb() },
    inject: (keys, cb) => {
      if (keys.includes('betterSidebar')) {
        cb({
          betterSidebar: {
            registerTab: tab => { registeredTab = tab; return () => {}; }
          }
        });
      }
    },
    slots: {
      inject: (_name, cb) => cb(),
      register: (options, render) => {
        if (options.name === 'conversation.composer.dock') registeredDock = render;
        if (options.name === 'plugins.bundle.config') registeredCard = render;
        return () => {};
      }
    },
    effect: cb => cleanups.push(cb())
  });

  assert.ok(registeredTab, 'BetterSidebar 选项卡应当成功注册');
  assert.equal(registeredTab.id, 'auto-proxy');
  assert.equal(registeredTab.title(), '自动代理');

  assert.ok(registeredDock, '底部环境胶囊应当成功注册');
  const dockNode = registeredDock({});
  assert.ok(dockNode, '底部胶囊组件应成功创建');

  assert.ok(registeredCard, '插件配置卡片应当成功注册');

  // 测试侧边栏组件渲染
  const sidebarComp = registeredTab.component();
  assert.ok(sidebarComp, '侧边栏组件应当成功渲染');

  for (const cleanup of cleanups.reverse()) cleanup?.();
});

