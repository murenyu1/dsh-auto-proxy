import z from '@deepseek-ai/schemastery';
import * as native from '@deepseek-ai/dsh-http-proxy';
import { createConfig } from './config.mjs';
import { ProxyController } from './lib/controller.mjs';

export const name = 'auto-proxy';
export const inject = [];
export const Config = createConfig(z);

export function apply(ctx, config) {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('auto-proxy') : console;
  const controller = new ProxyController({ native, logger });
  let running = false, disposed = false;
  const sync = async () => {
    if (running || disposed) return;
    running = true;
    try { await controller.sync(config); }
    catch { logger.warn('自动代理状态更新失败，请关闭插件后重新开启。'); }
    finally { running = false; }
  };
  ctx.effect(() => {
    const timer = setInterval(sync, 1000);
    void sync();
    return async () => {
      disposed = true; clearInterval(timer);
      // sync may be awaiting the native install; finish it before restoring.
      while (running) await new Promise(resolve => setTimeout(resolve, 10));
      await controller.dispose();
    };
  }, 'auto-proxy: native proxy lifecycle');
  ctx.inject(['webServer', 'connection'], web => {
    web.effect(() => web.webServer.register({
      kind: 'exact', path: '/plugins/auto-proxy/state',
      handler: async (req, res) => {
        const send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
        const rejection = web.connection.requestRejection(req);
        if (rejection !== undefined) return send(rejection, { error: '无权访问当前 DSH 连接。' });
        if (req.method === 'GET') return send(200, controller.snapshot());
        if (req.method === 'POST') {
          // Connection validates the request's origin/host/token. No user URLs or commands accepted.
          void controller.refresh(); return send(202, controller.snapshot());
        }
        res.setHeader('allow', 'GET, POST'); return send(405, { error: '请求方法不支持。' });
      }
    }), 'auto-proxy: fenced status route');
  });
}
