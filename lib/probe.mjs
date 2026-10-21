import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { normalizeProxy } from '../config.mjs';

// CONNECT + verified TLS + an actual HTTPS response, not just an open TCP port.
export function probeProxy(proxy, { target = 'https://github.com/', timeout = 6000, signal } = {}) {
  const endpoint = new URL(normalizeProxy(proxy));
  const url = new URL(target);
  return new Promise((resolve, reject) => {
    let socket, secure, request, finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      request?.destroy(); secure?.destroy(); socket?.destroy(); connect.destroy();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new Error('检测已取消。'));
    const timer = setTimeout(() => finish(new Error('代理连接或 GitHub 响应超时。')), timeout);
    const connect = http.request({ hostname: endpoint.hostname.replace(/^\[|\]$/g, ''), port: endpoint.port || 80, method: 'CONNECT', path: `${url.hostname}:${url.port || 443}`, agent: false });
    connect.on('error', () => finish(new Error('代理端口未提供可用的 HTTP CONNECT 服务。')));
    connect.on('response', () => finish(new Error('该端口不是可用的 HTTP 隧道代理。')));
    connect.on('connect', (res, stream, head) => {
      socket = stream;
      if (res.statusCode !== 200) return finish(new Error(`代理拒绝隧道连接（HTTP ${res.statusCode}）。`));
      if (head.length) stream.unshift(head);
      secure = tls.connect({ socket: stream, servername: url.hostname, rejectUnauthorized: true });
      secure.on('error', () => finish(new Error('代理后的 TLS 握手或证书验证失败。')));
      secure.once('secureConnect', () => {
        const agent = new https.Agent({ keepAlive: false });
        agent.createConnection = () => secure;
        request = https.request(url, { method: 'HEAD', agent, headers: { 'user-agent': 'dsh-auto-proxy/1.0' } }, response => {
          response.resume();
          const status = response.statusCode;
          if (status >= 200 && status < 400) finish(null, { status, checkedAt: new Date().toISOString() });
          else finish(new Error(`已连通代理，但 GitHub 返回 HTTP ${status}。`));
          agent.destroy();
        });
        request.on('error', () => { agent.destroy(); finish(new Error('通过代理请求 GitHub 失败。')); });
        request.end();
      });
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort(); else connect.end();
  });
}
