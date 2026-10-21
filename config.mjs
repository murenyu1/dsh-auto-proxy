export const DEFAULTS = { enabled: false, manualProxy: '', interval: 10 };

export function createConfig(z) {
  return z.object({
    enabled: z.boolean().default(false).volatile(),
    manualProxy: z.string().default('').volatile(),
    interval: z.number().min(5).max(300).step(1).default(10).volatile()
  });
}

export const valueOf = value => typeof value?.get === 'function' ? value.get() : value;
export function readConfig(config) {
  const value = Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => [key, valueOf(config[key]) ?? fallback]));
  if (typeof value.enabled !== 'boolean' || typeof value.manualProxy !== 'string' || !Number.isInteger(value.interval) || value.interval < 5 || value.interval > 300) throw new Error('配置无效：检测间隔须为 5–300 秒的整数。');
  if (value.manualProxy.trim()) normalizeProxy(value.manualProxy);
  return value;
}

// Only an explicit loopback HTTP endpoint may receive DSH traffic.
export function normalizeProxy(text) {
  if (typeof text !== 'string' || /[\x00-\x1f\x7f]/.test(text)) throw new Error('代理地址不能包含控制字符。');
  let url;
  try { url = new URL(text.includes('://') ? text.trim() : `http://${text.trim()}`); }
  catch { throw new Error('代理地址无效，请填写 http://127.0.0.1:端口。'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || Number(url.port || 80) < 1 || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('仅支持无认证的本机 HTTP／混合代理端口，例如 http://127.0.0.1:7897。');
  return url.origin;
}
