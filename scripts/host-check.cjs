// Run with DSH's bundled Electron in Node mode. No host/profile files are changed.
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

async function main() {
  const base = process.argv[2];
  if (!base) throw new Error('请传入安装目录 resources/app.asar/dsh/node_modules 的路径。');
  const rootFlag = process.argv.indexOf('--package-root');
  const pluginRoot = rootFlag < 0 ? path.resolve(__dirname, '..') : path.resolve(process.argv[rootFlag + 1]);
  const hostRequire = createRequire(path.join(base, '@deepseek-ai/dsh/package.json'));
  const hostImport = name => import(pathToFileURL(hostRequire.resolve(name)).href);
  const { Context } = await hostImport('@deepseek-ai/cordis');
  const { createRuntimeResolution, PluginPackages } = await hostImport('@deepseek-ai/dsh-app-boot');
  const resolution = await createRuntimeResolution({ installAnchor: path.join(base, '@deepseek-ai/dsh-desktop-host/package.json'), home: path.resolve(__dirname, '../.host-check') });
  const scope = new Context();
  await scope.plugin(PluginPackages, { resolution: { ...resolution, profileDir: pluginRoot } });
  console.log('使用 DSH 原生 PluginPackages 依赖解析（未添加自定义解析 hook）');
  const native = await hostImport('@deepseek-ai/dsh-http-proxy');
  const { HttpFetchProvider, DEFAULT_USER_AGENT } = await hostImport('@deepseek-ai/dsh-web-fetch-http');
  const { ProxyController } = await import(pathToFileURL(path.join(pluginRoot, 'lib/controller.mjs')).href);
  const plugin = await import(pathToFileURL(path.join(pluginRoot, 'index.mjs')).href);
  const packageInfo = JSON.parse(fs.readFileSync(path.join(base, '@deepseek-ai/dsh/package.json'), 'utf8'));
  console.log('DSH', packageInfo.version, '插件模块和原生配置 schema 加载成功');
  assert.equal(plugin.Config({}).enabled.get(), false);
  if (process.argv.includes('--clean-proxy-env')) {
    for (const key of ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY', 'no_proxy', 'NO_PROXY']) delete process.env[key];
    console.log('隔离测试进程：清空启动代理变量（不影响 DSH 或用户环境）');
  }
  const restoreBoot = await native.installProxyFromEnvironment({ get: key => process.env[key] === undefined ? undefined : { value: process.env[key] } }, () => {});
  const beforeRoute = native.proxyRouteFor(new URL('https://github.com/'));
  const beforeEnv = Object.fromEntries(['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY'].map(key => [key, process.env[key]]));
  const controller = new ProxyController({ native });
  let resolverCalls = 0;
  try {
    await controller.sync({ enabled: true }); await controller.pending;
    assert.equal(controller.snapshot().phase, 'connected', controller.snapshot().message);
    console.log('自动发现及验证', controller.snapshot().upstream, 'GitHub', controller.snapshot().githubStatus);
    const provider = new HttpFetchProvider({ timeoutMs: 20_000, maxResponseBytes: 3_000_000, maxBodyChars: 2000, maxRedirects: 5, userAgent: DEFAULT_USER_AGENT }, async () => { resolverCalls++; throw new Error('代理请求不应进入直连 DNS 路径'); });
    const page = await provider.fetch({ url: 'https://github.com/SuiSuiNian721/codex-connection-monitor' }, AbortSignal.timeout(25_000));
    assert.equal(resolverCalls, 0);
    assert.equal(page.statusCode, 200);
    console.log('原生 HttpFetchProvider 访问参考项目成功', JSON.stringify({ url: page.url, status: page.statusCode }));
    const response = await fetch('https://github.com/SuiSuiNian721/codex-connection-monitor', { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'dsh-auto-proxy-host-check' } });
    assert.equal(response.status, 200); assert.match(await response.text(), /codex-connection-monitor/);
    console.log('Node 原生 fetch 通过代理访问 GitHub 项目网页：HTTP 200');
    assert.equal(native.proxyRouteFor(new URL('http://localhost:9999')).proxied, false);
    assert.equal(native.proxyRouteFor(new URL('http://127.0.0.2:9999')).proxied, false);
    const privateCheck = new HttpFetchProvider({ timeoutMs: 1000, maxResponseBytes: 1000, maxBodyChars: 1000, maxRedirects: 0, userAgent: DEFAULT_USER_AGENT });
    await assert.rejects(privateCheck.fetch({ url: 'http://10.0.0.5/' }, AbortSignal.timeout(1000)), /non-public|blocked/i);
    console.log('本机直连与 DSH 私网访问限制保持有效');
    const overlay = native.proxyEnvironmentForChild();
    if (controller.snapshot().warnings.some(message => message.includes('DSH 启动时已有代理变量'))) {
      assert.equal(overlay.HTTPS_PROXY, beforeEnv.HTTPS_PROXY);
      console.log('已有启动代理变量时，子进程保留原策略，并显示限制提示');
    } else {
      assert.equal(overlay.HTTPS_PROXY, controller.snapshot().entry);
      console.log('DSH 新命令子进程可继承代理入口');
    }
    await controller.sync({ enabled: false });
    assert.equal(native.proxyRouteFor(new URL('https://github.com/')).proxied, beforeRoute.proxied);
    for (const [key, value] of Object.entries(beforeEnv)) assert.equal(process.env[key], value, key);
    console.log('关闭后原网络策略和环境变量已恢复');
    let statusRoute, credentialRecord;
    scope.provide('webServer', { host: '127.0.0.1', protocol: 'http:', register: route => {
      if (route.path === '/plugins/auto-proxy/state') statusRoute = route;
      return () => { if (statusRoute === route) statusRoute = undefined; };
    } });
    // Real browser authentication, with an isolated in-memory credential provider.
    scope.provide('credentials', { modifyRecord: async (_key, update) => {
      const changed = await update(credentialRecord);
      if (changed !== undefined) credentialRecord = changed;
      return credentialRecord;
    } });
    await scope.plugin(await hostImport('@deepseek-ai/dsh-client-connection'), {});
    const authority = '127.0.0.1:30333';
    const authUrl = new URL(scope.connection.authenticatedUrl(`http://${authority}/`));
    let cookie;
    scope.connection.authorizeIndex({ method: 'GET', url: authUrl.pathname + authUrl.search, headers: { host: authority } }, {
      writeHead: (code, headers) => { assert.equal(code, 303); cookie = headers['set-cookie'].split(';', 1)[0]; }, end() {}
    });
    assert.ok(cookie, '应由真实 Connection 签发隔离测试 cookie');
    await scope.plugin(plugin, { enabled: true });
    let state;
    for (let i = 0; i < 48; i++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      if (statusRoute) await statusRoute.handler({ method: 'GET', headers: { host: authority, cookie } }, { writeHead: code => assert.equal(code, 200), end: body => { state = JSON.parse(body); } });
      if (state?.phase === 'connected') break;
      if (state?.phase === 'error') throw new Error(state.message);
    }
    assert.equal(state?.phase, 'connected', '原生 Cordis 挂载后应能自动接入并报告状态');
    console.log('真实 Cordis 挂载插件、定时检测和状态路由成功');
    for (const method of ['GET', 'POST']) {
      for (const [headers, expected] of [
        [{ host: authority }, 401],
        [{ host: authority, cookie: 'invalid=1' }, 401],
        [{ host: 'evil.example', cookie }, 403],
        [{ host: authority, cookie, origin: 'https://evil.example' }, 403],
        [{ host: authority, cookie, 'sec-fetch-site': 'cross-site' }, 403]
      ]) await statusRoute.handler({ method, headers }, { writeHead: code => assert.equal(code, expected), end() {} });
    }
    console.log('真实 Connection 鉴权通过：无 cookie/伪造 cookie 返回 401，恶意 Host/Origin/跨站返回 403（GET 与 POST）');
    await scope.fiber.dispose();
    for (const [key, value] of Object.entries(beforeEnv)) assert.equal(process.env[key], value, key);
    console.log('真实 Cordis 卸载恢复策略及环境成功');
    console.log('HOST_CHECK_PASS');
  } finally { await controller.dispose(); await restoreBoot(); await scope.fiber.dispose(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
