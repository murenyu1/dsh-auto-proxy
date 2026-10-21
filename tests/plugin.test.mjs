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

test('前端模块登记原生设置卡片，开关、地址及间隔使用配置表单保存', () => {
  let plugin, fields, registered, saved = 0, modelDisposed = false;
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
    useState: value => [value, () => {}], useCallback: fn => fn, useEffect() {}
  };
  vm.runInNewContext(fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: entry => { plugin = entry.factory(name => name === 'react' ? React : { SettingsForm: 'NativeForm', SettingsFormModel: Form }); } } },
    URL, Date, fetch: () => { throw new Error('渲染测试不发网络请求'); }, setInterval, clearInterval, AbortController
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
    assert.equal(parse('manualProxy')('http://127.0.0.1:0'), undefined);
    assert.equal(parse('manualProxy')('socks5://127.0.0.1:7898'), undefined);
  } finally { for (const cleanup of cleanups.reverse()) cleanup?.(); }
  assert.equal(modelDisposed, true);
});
