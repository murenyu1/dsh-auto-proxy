import { discover } from './discovery.mjs';
import { probeProxy } from './probe.mjs';
import { createRelay } from './relay.mjs';
import { readConfig } from '../config.mjs';

const OWNER = Symbol.for('dsh-auto-proxy.owner');

export class ProxyController {
  constructor({ native, discovery = discover, probe = probeProxy, relayFactory = createRelay, logger = console }) {
    this.native = native; this.discovery = discovery; this.probe = probe; this.relayFactory = relayFactory; this.logger = logger;
    this.state = { phase: 'disabled', message: '自动代理已关闭。', upstream: null, entry: null, source: null, checkedAt: null, warnings: [] };
    this.config = { enabled: false, manualProxy: '', interval: 10 };
    this.nextCheck = 0;
  }

  snapshot() { return structuredClone(this.state); }

  async sync(raw) {
    if (this.disposed) return;
    let config;
    try { config = readConfig(raw); }
    catch (error) { await this.stop(); this.state.phase = 'error'; this.state.message = error.message; return; }
    const changed = config.manualProxy !== this.config.manualProxy;
    const intervalChanged = config.interval !== this.config.interval;
    this.config = config;
    if (!config.enabled) {
      if (this.state.phase === 'disabled' && !this.relay && !this.restore && !this.pending && globalThis[OWNER] !== this) return;
      await this.stop(); return;
    }
    if (!this.relay) {
      if (globalThis[OWNER] && globalThis[OWNER] !== this) { this.state.phase = 'error'; this.state.message = '另一个自动代理插件实例已启用，请只保留一个实例。'; return; }
      globalThis[OWNER] = this;
      try {
        this.relay = await this.relayFactory();
        const entry = this.relay.url;
        const noProxy = process.env.no_proxy ?? process.env.NO_PROXY ?? '';
        const env = { get: key => {
          const value = ({ http_proxy: entry, https_proxy: entry, no_proxy: noProxy })[key];
          return value === undefined ? undefined : { value };
        } };
        this.restore = await this.native.installProxyFromEnvironment(env, () => {});
        // Do not assume that changing global fetch also updated web_fetch's policy.
        const route = this.native.proxyRouteFor(new URL('https://github.com/'));
        if (!route.proxied || route.proxy !== entry) throw new Error('DSH 原生页面抓取未接入当前代理策略。请检查 NO_PROXY 是否包含 GitHub 或 *。');
        const overlay = this.native.proxyEnvironmentForChild();
        const warnings = [];
        if (['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY'].some(key => overlay[key] !== undefined && overlay[key] !== entry)) warnings.push('DSH 启动时已有代理变量：原生命令子进程可能仍沿用原设置；本插件不覆盖其原始策略。');
        this.baseWarnings = warnings;
        this.state = { ...this.state, phase: 'waiting', message: '正在检测本机代理端口。', entry, warnings };
        this.nextCheck = 0;
      } catch (error) {
        await this.stop(); this.state.phase = 'error'; this.state.message = error.message; return;
      }
    }
    if (changed) {
      this.abort?.abort(); await this.pending;
      this.relay.setUpstream(null); this.state.upstream = null; this.state.source = null; this.nextCheck = 0;
    }
    if (intervalChanged) this.nextCheck = 0;
    if (Date.now() >= this.nextCheck && !this.pending) this.refresh();
  }

  refresh() {
    if (!this.relay || this.disposed || !this.config.enabled || this.pending) return this.pending;
    const abort = new AbortController(); this.abort = abort;
    this.state.phase = 'checking'; this.state.message = '正在验证代理及 GitHub 连通性。';
    const task = async () => {
      try {
        const entryPort = new URL(this.relay.url).port;
        const warnings = [];
        const candidates = (await this.discovery({ ...this.config, onWarning: message => warnings.push(message) })).filter(item => new URL(item.url).port !== entryPort);
        if (abort.signal.aborted) return;
        this.state.warnings = [...(this.baseWarnings ?? []), ...new Set(warnings)];
        candidates.sort((a, b) => Number(b.url === this.state.upstream) - Number(a.url === this.state.upstream));
        let selected, result;
        // Bound concurrent probes and stop after the first successful group.
        for (let start = 0; start < candidates.length && !selected; start += 3) {
          const group = candidates.slice(start, start + 3);
          const results = await Promise.allSettled(group.map(item => this.probe(item.url, { signal: abort.signal })));
          if (abort.signal.aborted) return;
          const index = results.findIndex(item => item.status === 'fulfilled');
          if (index >= 0) { selected = group[index]; result = results[index].value; }
        }
        if (abort.signal.aborted || !this.relay) return;
        this.relay.setUpstream(selected?.url);
        this.state = { ...this.state, phase: selected ? 'connected' : 'offline', upstream: selected?.url ?? null, source: selected?.source ?? null, checkedAt: new Date().toISOString(), githubStatus: result?.status ?? null,
          message: selected ? '已连接代理，GitHub HTTPS 检测成功。' : '未找到能访问 GitHub 的 HTTP／混合代理端口。请确认代理软件正在运行且节点可用，或手动指定端口。' };
      } catch (error) {
        if (!abort.signal.aborted && this.relay) { this.relay.setUpstream(null); this.state = { ...this.state, phase: 'error', upstream: null, source: null, checkedAt: new Date().toISOString(), message: error.message }; }
      } finally { this.nextCheck = Date.now() + this.config.interval * 1000; }
    };
    this.pending = task().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  async stop() {
    this.abort?.abort();
    await this.pending;
    const restore = this.restore; this.restore = undefined;
    // Native disposer restores dispatcher/policy/env synchronously, then drains its agent.
    const draining = restore?.();
    const relay = this.relay; this.relay = undefined;
    await relay?.close();
    await draining;
    if (globalThis[OWNER] === this) delete globalThis[OWNER];
    this.state = { phase: 'disabled', message: '自动代理已关闭，已恢复 DSH 原代理策略。', upstream: null, entry: null, source: null, checkedAt: null, warnings: [] };
  }

  async dispose() { this.disposed = true; await this.stop(); }
}
