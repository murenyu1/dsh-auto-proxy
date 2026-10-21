window.__ModuleLoader__.load({
  id: 'dsh-plugin-auto-proxy',
  factory: function (require) {
    const React = require('react');
    const { SettingsForm, SettingsFormModel } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;
    const PACKAGE = 'dsh-plugin-auto-proxy';
    const labels = { disabled: '已关闭', waiting: '等待代理', checking: '检测中', connected: '已连接', offline: '代理不可用', error: '发生错误' };
    class Controller {
      constructor(scope) {
        this.form = new SettingsFormModel(scope, [
          { field: 'enabled', format: value => String(value ?? false), parse: text => ['true', 'false'].includes(text) ? { kind: 'set', value: text === 'true' } : undefined },
          { field: 'manualProxy', format: value => value ?? '', parse: text => { try { if (/[\x00-\x1f\x7f]/.test(text)) return undefined; if (text.trim()) { const url = new URL(text.includes('://') ? text.trim() : `http://${text.trim()}`); if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.port || Number(url.port) < 1 || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined; } return { kind: 'set', value: text.trim() }; } catch { return undefined; } } },
          { field: 'interval', format: value => String(value ?? 10), parse: text => Number.isInteger(Number(text)) && Number(text) >= 5 && Number(text) <= 300 ? { kind: 'set', value: Number(text) } : undefined }
        ]);
        this.actions = this.form.actions();
        this.store = this.form.bind(() => ({ ...this.form.shell(), enabled: this.form.field('enabled').text === 'true', manualProxy: this.form.field('manualProxy').text, interval: this.form.field('interval').text }));
      }
      dispose() { this.form.dispose(); }
    }
    const box = { border: '1px solid var(--dsw-alias-border-primary, #8885)', borderRadius: 12, padding: 20, display: 'grid', gap: 16 };
    const input = { padding: 8, border: '1px solid #8887', borderRadius: 6, background: 'transparent', color: 'inherit', width: '100%', boxSizing: 'border-box' };
    function Card({ controller }) {
      const state = React.useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot, controller.store.getSnapshot);
      const [status, setStatus] = React.useState(null);
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const request = React.useCallback(async (method = 'GET', signal) => {
        const response = await fetch('/plugins/auto-proxy/state', { method, credentials: 'same-origin', cache: 'no-store', signal });
        if (!response.ok) throw new Error(`无法读取自动代理状态（HTTP ${response.status}）。`);
        return response.json();
      }, []);
      React.useEffect(() => {
        const abort = new AbortController(); let active = true, pending = false;
        const read = async () => { if (pending) return; pending = true; try { const value = await request('GET', abort.signal); if (active) { setStatus(value); setError(''); } } catch (e) { if (active) setError(e.message); } finally { pending = false; } };
        void read(); const timer = setInterval(read, 2000);
        return () => { active = false; abort.abort(); clearInterval(timer); };
      }, [request]);
      const disabled = !state.writable || state.saving;
      return h(SettingsForm, { state, labels: { unavailable: '插件尚未加载。', readOnly: '当前设置为只读。', saveFailed: '保存失败，请保留修改后重试。', save: '保存并应用', saving: '保存中…' }, onSave: () => controller.actions.save(), onDiscard: controller.actions.discard },
        h('div', { style: box },
          h('h3', { style: { margin: 0 } }, '自动代理'),
          h('p', { style: { margin: 0, opacity: 0.75 } }, '正常启动 DSH 后，在这里开启并保存。自动检测本地 HTTP／混合端口，无需全局模式或 TUN。'),
          h('label', null, h('input', { type: 'checkbox', checked: state.enabled, disabled, onChange: event => controller.actions.edit('enabled', String(event.target.checked)) }), ' 开启自动代理'),
          h('label', null, '手动代理地址（留空自动检测）', h('input', { style: input, placeholder: 'http://127.0.0.1:7897', value: state.manualProxy, disabled, onChange: event => controller.actions.edit('manualProxy', event.target.value) })),
          h('label', null, '检测间隔（秒，5–300）', h('input', { style: input, type: 'number', min: 5, max: 300, value: state.interval, disabled, onChange: event => controller.actions.edit('interval', event.target.value) })),
          state.invalid ? h('p', { role: 'alert' }, '请填写有效的本机 HTTP 代理地址及 5–300 秒的整数间隔。') : null,
          h('div', { role: 'status', style: { ...box, padding: 12 } },
            h('strong', null, labels[status?.phase] || '正在读取状态…'),
            h('span', null, status?.message || ''),
            status?.upstream ? h('span', null, `代理地址：${status.upstream}（${status.source}）`) : null,
            status?.entry ? h('span', null, `DSH 本地入口：${status.entry}`) : null,
            status?.checkedAt ? h('span', null, `最近检测：${new Date(status.checkedAt).toLocaleTimeString('zh-CN')}`) : null,
            ...(status?.warnings || []).map((text, index) => h('p', { key: index }, text)),
            error ? h('p', { role: 'alert' }, error) : null),
          h('button', { type: 'button', disabled: busy || !status?.entry, onClick: async () => { setBusy(true); try { setStatus(await request('POST')); setError(''); } catch (e) { setError(e.message); } finally { setBusy(false); } } }, busy ? '正在请求…' : '重新检测'),
          h('small', null, '代理不可用时，插件管理的请求会报错并等待恢复。关闭插件并保存后恢复 DSH 原网络策略。检测成功代表 GitHub HTTPS 可达，不代表所有网站或模型调用均成功。')));
    }
    function apply(ctx) {
      const controller = new Controller(ctx.configForms.get('auto-proxy'));
      ctx.effect(() => () => controller.dispose(), 'auto-proxy: form');
      ctx.effect(() => ctx.configForms.whileServed(['auto-proxy'], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE }, props => h(Card, { ...props, controller })))), 'auto-proxy: settings card');
    }
    return { inject: ['slots', 'configForms'], apply };
  }
});
