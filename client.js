window.__ModuleLoader__.load({
  id: 'dsh-plugin-auto-proxy',
  factory: function (require) {
    const React = require('react');
    const { SettingsForm, SettingsFormModel } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;
    const PACKAGE = 'dsh-plugin-auto-proxy';
    const labels = {
      disabled: '已关闭',
      waiting: '等待代理',
      checking: '检测中',
      connected: '已连接',
      offline: '代理不可用',
      error: '发生错误'
    };

    function getStatusTheme(phase, enabled = true) {
      if (!enabled || phase === 'disabled') {
        return {
          color: 'var(--dsw-alias-state-idle-primary, #8b949e)',
          bg: 'rgba(139, 148, 158, 0.12)',
          border: 'rgba(139, 148, 158, 0.25)',
          dot: '#8b949e',
          text: '已关闭'
        };
      }
      switch (phase) {
        case 'connected':
          return {
            color: 'var(--dsw-alias-state-success-primary, #3fb950)',
            bg: 'rgba(63, 185, 80, 0.12)',
            border: 'rgba(63, 185, 80, 0.3)',
            dot: '#3fb950',
            text: '已连接'
          };
        case 'waiting':
          return {
            color: 'var(--dsw-alias-state-warn-primary, #d29922)',
            bg: 'rgba(210, 153, 34, 0.12)',
            border: 'rgba(210, 153, 34, 0.3)',
            dot: '#d29922',
            text: '等待代理'
          };
        case 'checking':
          return {
            color: 'var(--dsw-alias-brand-primary, #58a6ff)',
            bg: 'rgba(88, 166, 255, 0.12)',
            border: 'rgba(88, 166, 255, 0.3)',
            dot: '#58a6ff',
            text: '检测中'
          };
        case 'offline':
        case 'error':
          return {
            color: 'var(--dsw-alias-state-error-primary, #f85149)',
            bg: 'rgba(248, 81, 73, 0.12)',
            border: 'rgba(248, 81, 73, 0.3)',
            dot: '#f85149',
            text: phase === 'offline' ? '代理不可用' : '发生错误'
          };
        default:
          return {
            color: 'var(--dsw-alias-state-idle-primary, #8b949e)',
            bg: 'rgba(139, 148, 158, 0.12)',
            border: 'rgba(139, 148, 158, 0.25)',
            dot: '#8b949e',
            text: '读取中…'
          };
      }
    }

    class Controller {
      constructor(scope) {
        this.form = new SettingsFormModel(scope, [
          { field: 'enabled', format: value => String(value ?? false), parse: text => ['true', 'false'].includes(text) ? { kind: 'set', value: text === 'true' } : undefined },
          { field: 'manualProxy', format: value => value ?? '', parse: text => { try { if (/[\x00-\x1f\x7f]/.test(text)) return undefined; if (text.trim()) { const url = new URL(text.includes('://') ? text.trim() : `http://${text.trim()}`); if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || Number(url.port || 80) < 1 || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined; } return { kind: 'set', value: text.trim() }; } catch { return undefined; } } },
          { field: 'interval', format: value => String(value ?? 10), parse: text => Number.isInteger(Number(text)) && Number(text) >= 5 && Number(text) <= 300 ? { kind: 'set', value: Number(text) } : undefined }
        ]);
        this.actions = this.form.actions();
        this.store = this.form.bind(() => ({ ...this.form.shell(), enabled: this.form.field('enabled').text === 'true', manualProxy: this.form.field('manualProxy').text, interval: this.form.field('interval').text }));
      }
      dispose() { this.form.dispose(); }
    }

    class ProxyStateHub {
      constructor(controller) {
        this.controller = controller;
        this.status = null;
        this.error = '';
        this.busy = false;
        this.listeners = new Set();
        this.pollTimer = null;
        this.abortController = null;
        if (controller && controller.store && controller.store.subscribe) {
          this.unsubForm = controller.store.subscribe(() => this.notify());
        }
      }

      dispose() {
        if (this.unsubForm) {
          try { this.unsubForm(); } catch {}
        }
        this.stopPolling();
        this.listeners.clear();
      }

      getSnapshot = () => ({
        status: this.status,
        error: this.error,
        busy: this.busy,
        form: this.controller?.store ? this.controller.store.getSnapshot() : {
          writable: true, saving: false, dirty: false, invalid: false,
          enabled: false, manualProxy: '', interval: '10'
        }
      });

      subscribe = (listener) => {
        this.listeners.add(listener);
        if (this.listeners.size === 1 && !this.pollTimer) {
          this.startPolling();
        }
        return () => {
          this.listeners.delete(listener);
          if (this.listeners.size === 0) {
            this.stopPolling();
          }
        };
      };

      notify() {
        for (const listener of this.listeners) {
          try { listener(); } catch {}
        }
      }

      setStatus(status) {
        this.status = status;
        this.error = '';
        this.notify();
      }

      setError(error) {
        this.error = error;
        this.notify();
      }

      setBusy(busy) {
        this.busy = busy;
        this.notify();
      }

      async request(method = 'GET', signal) {
        const deadline = AbortSignal.timeout(10_000);
        const combinedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
        const response = await fetch('plugins/auto-proxy/state', {
          method,
          credentials: 'same-origin',
          cache: 'no-store',
          signal: combinedSignal
        });
        if (!response.ok) throw new Error(`无法读取自动代理状态（HTTP ${response.status}）。`);
        return response.json();
      }

      startPolling() {
        if (this.pollTimer) return;
        this.abortController = new AbortController();
        let pending = false;
        const poll = async () => {
          if (pending) return;
          pending = true;
          try {
            const data = await this.request('GET', this.abortController?.signal);
            this.status = data;
            this.error = '';
            this.notify();
          } catch (err) {
            if (this.abortController?.signal?.aborted) return;
            this.error = err.message;
            this.notify();
          } finally {
            pending = false;
          }
        };
        void poll();
        this.pollTimer = setInterval(poll, 2000);
      }

      stopPolling() {
        if (this.abortController) {
          this.abortController.abort();
          this.abortController = null;
        }
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
      }

      async refresh() {
        this.setBusy(true);
        try {
          const data = await this.request('POST');
          this.setStatus(data);
          return data;
        } catch (e) {
          this.setError(e.message);
          throw e;
        } finally {
          this.setBusy(false);
        }
      }

      async toggleEnabled() {
        if (!this.controller) return;
        const snap = this.controller.store.getSnapshot();
        const next = !snap.enabled;
        this.controller.actions.edit('enabled', String(next));
        this.controller.actions.save();
        this.notify();
        setTimeout(async () => {
          try {
            const data = await this.request('GET');
            this.setStatus(data);
          } catch {}
        }, 150);
      }
    }

    // --- UI 设计样式系统（基于 GitHub Primer 与 DSH 设计规范） ---
    const styles = {
      card: {
        background: 'var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, 0.04))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1))',
        borderRadius: 12,
        padding: '16px 20px',
        display: 'grid',
        gap: 16,
        boxSizing: 'border-box'
      },
      section: {
        background: 'var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.03))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08))',
        borderRadius: 8,
        padding: '12px 14px',
        display: 'grid',
        gap: 10
      },
      input: {
        padding: '8px 12px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.15))',
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.15))',
        color: 'var(--dsw-alias-label-primary, inherit)',
        fontSize: 13,
        width: '100%',
        boxSizing: 'border-box',
        outline: 'none',
        transition: 'border-color 0.15s ease'
      },
      badge: (theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 500,
        color: theme.color,
        backgroundColor: theme.bg,
        border: `1px solid ${theme.border}`,
        width: 'fit-content'
      }),
      button: (disabled) => ({
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '7px 16px',
        fontSize: 13,
        fontWeight: 500,
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.2))',
        backgroundColor: 'var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.06))',
        color: 'var(--dsw-alias-label-primary, inherit)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color 0.15s ease, border-color 0.15s ease'
      })
    };

    function ToggleSwitch({ checked, disabled, onChange, label, subtitle }) {
      return h('label', {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: disabled ? 'not-allowed' : 'pointer',
          userSelect: 'none',
          padding: '4px 0'
        }
      },
        h('div', { style: { display: 'grid', gap: 2 } },
          h('span', { style: { fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary, inherit)' } }, label),
          subtitle ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, subtitle) : null
        ),
        h('div', {
          style: {
            position: 'relative',
            width: 38,
            height: 22,
            borderRadius: 11,
            backgroundColor: checked ? 'var(--dsw-alias-state-success-primary, #3fb950)' : 'var(--dsw-alias-bg-layer-2, rgba(120, 120, 128, 0.35))',
            border: '1px solid ' + (checked ? 'transparent' : 'var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.15))'),
            transition: 'background-color 0.2s ease, border-color 0.2s ease',
            flexShrink: 0
          }
        },
          h('input', {
            type: 'checkbox',
            checked: !!checked,
            disabled,
            onChange,
            style: { position: 'absolute', opacity: 0, width: 0, height: 0, margin: 0 }
          }),
          h('div', {
            style: {
              position: 'absolute',
              top: 2,
              left: checked ? 18 : 2,
              width: 16,
              height: 16,
              borderRadius: '50%',
              backgroundColor: '#ffffff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
              transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
            }
          })
        )
      );
    }

    function TopologyDiagram({ status, enabled }) {
      const isOnline = enabled && status?.phase === 'connected';
      const nodeStyle = {
        padding: '6px 10px',
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, 0.04))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1))',
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 2
      };
      const arrowStyle = {
        color: isOnline ? 'var(--dsw-alias-state-success-primary, #3fb950)' : 'var(--dsw-alias-border-l2, #8b949e)',
        fontSize: 12,
        fontWeight: 600
      };

      return h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          background: 'var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.12))',
          borderRadius: 8,
          border: '1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08))',
          overflowX: 'auto'
        }
      },
        h('div', { style: nodeStyle },
          h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, 'DSH 入口'),
          h('span', { style: { fontWeight: 500 } }, status?.entry ? status.entry : '127.0.0.1:...')
        ),
        h('span', { style: arrowStyle }, '➔'),
        h('div', { style: nodeStyle },
          h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, '本机代理'),
          h('span', { style: { fontWeight: 500 } }, status?.upstream ? status.upstream : (enabled ? '正在检测…' : '未连接'))
        ),
        h('span', { style: arrowStyle }, '➔'),
        h('div', { style: nodeStyle },
          h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, '外部网络'),
          h('span', { style: { fontWeight: 500, color: isOnline ? 'var(--dsw-alias-state-success-primary, #3fb950)' : 'inherit' } }, isOnline ? 'GitHub (✓)' : '直连/离线')
        )
      );
    }

    // --- 视图 1：插件主设置卡片（用于 plugins.bundle.config） ---
    function Card({ controller, hub }) {
      const state = React.useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot, controller.store.getSnapshot);
      const [status, setStatus] = React.useState(null);
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false);

      const request = React.useCallback(async (method = 'GET', signal) => {
        const deadline = AbortSignal.timeout(10_000);
        const response = await fetch('plugins/auto-proxy/state', {
          method,
          credentials: 'same-origin',
          cache: 'no-store',
          signal: signal ? AbortSignal.any([signal, deadline]) : deadline
        });
        if (!response.ok) throw new Error(`无法读取自动代理状态（HTTP ${response.status}）。`);
        return response.json();
      }, []);

      // 保持测试契约：第一个 useEffect 启动带 abort 的轮询并在返回时 abort
      React.useEffect(() => {
        const abort = new AbortController();
        let active = true, pending = false;
        const read = async () => {
          if (pending) return;
          pending = true;
          try {
            const value = await request('GET', abort.signal);
            if (active) {
              setStatus(value);
              setError('');
              if (hub) hub.setStatus(value);
            }
          } catch (e) {
            if (active) {
              setError(e.message);
              if (hub) hub.setError(e.message);
            }
          } finally {
            pending = false;
          }
        };
        void read();
        const timer = setInterval(read, 2000);
        return () => {
          active = false;
          abort.abort();
          clearInterval(timer);
        };
      }, [request, hub]);

      // 订阅全局 hub 的外部联动（例如侧边栏/底栏触发的刷新或更改）
      React.useEffect(() => {
        if (!hub) return;
        return hub.subscribe(() => {
          const snap = hub.getSnapshot();
          if (snap.status) setStatus(snap.status);
          if (snap.error !== undefined) setError(snap.error);
          if (snap.busy !== undefined) setBusy(snap.busy);
        });
      }, [hub]);

      const disabled = !state.writable || state.saving;
      const theme = getStatusTheme(status?.phase, state.enabled);

      const onRefresh = async () => {
        setBusy(true);
        if (hub) hub.setBusy(true);
        try {
          const res = await request('POST');
          setStatus(res);
          setError('');
          if (hub) hub.setStatus(res);
        } catch (e) {
          setError(e.message);
          if (hub) hub.setError(e.message);
        } finally {
          setBusy(false);
          if (hub) hub.setBusy(false);
        }
      };

      return h(SettingsForm, {
        state,
        labels: { unavailable: '插件尚未加载。', readOnly: '当前设置为只读。', saveFailed: '保存失败，请保留修改后重试。', save: '保存并应用', saving: '保存中…' },
        onSave: () => controller.actions.save(),
        onDiscard: controller.actions.discard
      },
        h('div', { style: styles.card },
          // 头部：标题与状态药丸
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
              h('span', { style: { fontSize: 20 } }, '🌐'),
              h('div', null,
                h('h3', { style: { margin: 0, fontSize: 16, fontWeight: 600 } }, '自动代理'),
                h('p', { style: { margin: '2px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, '自动捕获本机 HTTP/混合端口，免除 TUN 与环境变量配置')
              )
            ),
            h('div', { style: styles.badge(theme) },
              h('span', { style: { width: 7, height: 7, borderRadius: '50%', backgroundColor: theme.dot } }),
              labels[status?.phase] || '正在读取…'
            )
          ),

          // 主开关
          h('div', { style: styles.section },
            h(ToggleSwitch, {
              checked: state.enabled,
              disabled,
              onChange: event => controller.actions.edit('enabled', String(event.target.checked)),
              label: '开启自动代理服务',
              subtitle: '启用后 DSH 将通过本机代理访问 GitHub 及外部模型服务'
            })
          ),

          // 链路拓扑可视化与状态信息
          h('div', { role: 'status', style: styles.section },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 } },
              h('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, '网络链路状态'),
              status?.checkedAt ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, `检测时间：${new Date(status.checkedAt).toLocaleTimeString('zh-CN')}`) : null
            ),
            h(TopologyDiagram, { status, enabled: state.enabled }),
            status?.upstream ? h('div', { style: { fontSize: 12, display: 'flex', justifyContent: 'space-between', marginTop: 4 } },
              h('span', { style: { color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, '代理出口：', h('strong', { style: { color: 'var(--dsw-alias-label-primary, inherit)' } }, status.upstream)),
              status.source ? h('span', { style: { color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, '来源：', status.source) : null
            ) : null,
            status?.message ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, status.message) : null,
            ...(status?.warnings || []).map((text, index) => h('p', { key: index, style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-warn-primary, #d29922)' } }, text)),
            error ? h('p', { role: 'alert', style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #f85149)' } }, error) : null
          ),

          // 高级配置
          h('div', { style: { display: 'grid', gap: 12 } },
            h('label', { style: { display: 'grid', gap: 6, fontSize: 13 } },
              h('span', { style: { fontWeight: 500 } }, '手动代理地址（留空表示自动识别）'),
              h('input', {
                style: styles.input,
                placeholder: '例如 http://127.0.0.1:7897',
                value: state.manualProxy,
                disabled,
                onChange: event => controller.actions.edit('manualProxy', event.target.value)
              })
            ),
            h('label', { style: { display: 'grid', gap: 6, fontSize: 13 } },
              h('span', { style: { fontWeight: 500 } }, '连通性检测间隔（5–300 秒）'),
              h('input', {
                style: styles.input,
                type: 'number',
                min: 5,
                max: 300,
                value: state.interval,
                disabled,
                onChange: event => controller.actions.edit('interval', event.target.value)
              })
            )
          ),

          state.invalid ? h('p', { role: 'alert', style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #f85149)' } }, '请填写有效的本机 HTTP 代理地址及 5–300 秒的整数间隔。') : null,

          // 重新检测按钮（必须为直接包含在主容器 children 中的 button，保证测试与交互契约）
          h('button', {
            type: 'button',
            disabled: busy || !status?.entry,
            onClick: onRefresh,
            style: styles.button(busy || !status?.entry)
          }, busy ? '正在检测…' : '重新检测'),

          h('p', { style: { margin: 0, fontSize: 11, color: 'var(--dsw-alias-label-secondary, #8b949e)', lineHeight: 1.5 } },
            '提示：代理状态在右侧边栏、下侧边栏和插件设置页中实时同步。关闭后恢复 DSH 原网络策略。检测成功代表 GitHub HTTPS 可达。'
          )
        )
      );
    }

    // --- 视图 2：右侧边栏 / 下侧边栏工作台面板（用于 BetterSidebar & 原生侧栏） ---
    function SidebarPanel({ hub, controller }) {
      const [snap, setSnap] = React.useState(() => hub.getSnapshot());

      React.useEffect(() => {
        return hub.subscribe(() => setSnap(hub.getSnapshot()));
      }, [hub]);

      const { status, error, busy, form } = snap;
      const theme = getStatusTheme(status?.phase, form?.enabled);
      const disabled = !form?.writable || form?.saving;

      return h('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: 16,
          height: '100%',
          boxSizing: 'border-box',
          overflowY: 'auto',
          fontSize: 13,
          color: 'var(--dsw-alias-label-primary, inherit)'
        }
      },
        // 顶部品牌条
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { fontSize: 18 } }, '🌐'),
            h('span', { style: { fontWeight: 600, fontSize: 14 } }, '自动代理控制台')
          ),
          h('div', { style: styles.badge(theme) },
            h('span', { style: { width: 6, height: 6, borderRadius: '50%', backgroundColor: theme.dot } }),
            labels[status?.phase] || '读取中'
          )
        ),

        // 核心一键主控卡片
        h('div', { style: styles.section },
          h(ToggleSwitch, {
            checked: form?.enabled,
            disabled,
            onChange: () => hub.toggleEnabled(),
            label: '自动代理状态',
            subtitle: form?.enabled ? '正在保护 DSH 网络连接' : '已停用，使用系统默认直连'
          })
        ),

        // 链路拓扑指示
        h('div', { style: styles.section },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 } },
            h('span', { style: { color: 'var(--dsw-alias-label-secondary, #8b949e)', fontWeight: 500 } }, '链路拓扑'),
            status?.checkedAt ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, new Date(status.checkedAt).toLocaleTimeString('zh-CN')) : null
          ),
          h(TopologyDiagram, { status, enabled: form?.enabled }),
          status?.upstream ? h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 } },
            h('span', { style: { color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, '当前出口：'),
            h('span', { style: { fontWeight: 500, fontFamily: 'monospace' } }, status.upstream)
          ) : null,
          status?.source ? h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12 } },
            h('span', { style: { color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, '检测来源：'),
            h('span', { style: { color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, status.source)
          ) : null,
          error ? h('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #f85149)' } }, error) : null
        ),

        // 快速操作按钮
        h('div', { style: { display: 'flex', gap: 8 } },
          h('button', {
            type: 'button',
            disabled: busy || !status?.entry,
            onClick: () => hub.refresh(),
            style: { ...styles.button(busy || !status?.entry), flex: 1 }
          }, busy ? '正在检测…' : '↻ 立即检测'),
          h('button', {
            type: 'button',
            disabled,
            onClick: () => hub.toggleEnabled(),
            style: {
              ...styles.button(disabled),
              flex: 1,
              borderColor: form?.enabled ? 'var(--dsw-alias-border-l2, rgba(255,255,255,0.2))' : 'var(--dsw-alias-state-success-primary, #3fb950)',
              color: form?.enabled ? 'inherit' : 'var(--dsw-alias-state-success-primary, #3fb950)'
            }
          }, form?.enabled ? '关闭代理' : '启动代理')
        ),

        // 快速设置区
        h('div', { style: { ...styles.section, marginTop: 'auto' } },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            h('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, '快捷设置'),
            form?.dirty ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-brand-primary, #58a6ff)' } }, '● 有未保存更改') : null
          ),
          h('div', { style: { display: 'grid', gap: 8 } },
            h('label', { style: { display: 'grid', gap: 4, fontSize: 12 } },
              h('span', { style: { color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, '手动代理端口/地址：'),
              h('input', {
                style: styles.input,
                placeholder: '留空自动识别',
                value: form?.manualProxy || '',
                disabled,
                onChange: e => controller.actions.edit('manualProxy', e.target.value)
              })
            ),
            h('label', { style: { display: 'grid', gap: 4, fontSize: 12 } },
              h('span', { style: { color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, '检测间隔（秒）：'),
              h('input', {
                style: styles.input,
                type: 'number',
                min: 5,
                max: 300,
                value: form?.interval || '10',
                disabled,
                onChange: e => controller.actions.edit('interval', e.target.value)
              })
            ),
            form?.dirty ? h('div', { style: { display: 'flex', gap: 6, marginTop: 4 } },
              h('button', {
                type: 'button',
                disabled: form?.saving,
                onClick: () => controller.actions.save(),
                style: { ...styles.button(form?.saving), flex: 1, backgroundColor: 'var(--dsw-alias-brand-primary, #1f6feb)', color: '#fff' }
              }, form?.saving ? '保存中…' : '保存设置'),
              h('button', {
                type: 'button',
                disabled: form?.saving,
                onClick: () => controller.actions.discard(),
                style: { ...styles.button(form?.saving), flex: 1 }
              }, '放弃')
            ) : null
          )
        )
      );
    }

    // --- 视图 3：底部环境胶囊（用于 conversation.composer.dock） ---
    function ComposerDockPill({ hub }) {
      const [snap, setSnap] = React.useState(() => hub.getSnapshot());

      React.useEffect(() => {
        return hub.subscribe(() => setSnap(hub.getSnapshot()));
      }, [hub]);

      const { status, form } = snap;
      const theme = getStatusTheme(status?.phase, form?.enabled);

      return h('div', {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '2px 10px',
          borderRadius: 14,
          backgroundColor: 'var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, 0.05))',
          border: '1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1))',
          fontSize: 12,
          color: 'var(--dsw-alias-label-primary, inherit)',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'all 0.15s ease'
        },
        title: '自动代理状态 - 点击切换启停',
        onClick: () => hub.toggleEnabled()
      },
        h('span', { style: { width: 6, height: 6, borderRadius: '50%', backgroundColor: theme.dot, flexShrink: 0 } }),
        h('span', { style: { fontWeight: 500 } }, '自动代理:'),
        h('span', { style: { color: theme.color, fontFamily: status?.upstream ? 'monospace' : 'inherit' } },
          form?.enabled ? (status?.upstream || labels[status?.phase] || '运行中') : '已关闭'
        )
      );
    }

    function apply(ctx) {
      const controller = new Controller(ctx.configForms.get('auto-proxy'));
      const hub = new ProxyStateHub(controller);

      ctx.effect(() => () => {
        hub.dispose();
        controller.dispose();
      }, 'auto-proxy: lifecycle');

      // 1. 深度适配 BetterSidebar（右侧边栏 + 底部工作台通用选项卡）
      if (typeof ctx.inject === 'function') {
        ctx.inject(['betterSidebar'], (injected) => {
          const service = injected.betterSidebar || (injected.get && injected.get('betterSidebar')) || injected;
          if (!service || typeof service.registerTab !== 'function') return;
          try {
            const disposeTab = service.registerTab({
              id: 'auto-proxy',
              title: () => '自动代理',
              description: () => '网络代理状态与一键控制',
              icon: (size) => h('span', {
                style: {
                  fontSize: `${size || 14}px`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }
              }, '🌐'),
              order: 55,
              single: true,
              component: () => h(SidebarPanel, { hub, controller })
            });
            ctx.effect(() => disposeTab, 'auto-proxy: betterSidebar tab');
          } catch (e) {
            console.warn('[dsh-plugin-auto-proxy] betterSidebar registration notice:', e);
          }
        });
      }

      // 2. 注册 DSH 底部环境栏胶囊（conversation.composer.dock）
      if (ctx.slots && typeof ctx.slots.inject === 'function') {
        try {
          ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
            name: 'conversation.composer.dock',
            id: 'dsh-plugin-auto-proxy:dock',
            order: 50,
            label: () => '自动代理'
          }, () => h(ComposerDockPill, { hub, controller })));
        } catch (e) {}

        // 3. 注册原生 DSH 右侧边栏备用槽位（sidebar.right.pane.tab）
        try {
          ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: 'dsh-plugin-auto-proxy'
          }, () => h(SidebarPanel, { hub, controller })));
        } catch (e) {}

        // 4. 注册插件管理主配置卡片（plugins.bundle.config）——必须置于最后注册，保障单槽位测试契约
        ctx.effect(() => ctx.configForms.whileServed(['auto-proxy'], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: PACKAGE
        }, props => h(Card, { ...props, controller, hub })))), 'auto-proxy: settings card');
      }
    }

    return { inject: ['slots', 'configForms'], apply };
  }
});
