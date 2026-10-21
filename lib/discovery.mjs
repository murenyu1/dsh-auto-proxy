import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeProxy } from '../config.mjs';

const exec = promisify(execFile);
export function portsFromYaml(text) {
  return [...text.matchAll(/^(?:mixed-port|port):\s*["']?(\d+)["']?\s*(?:#.*)?$/gm)]
    .map(match => Number(match[1])).filter(port => port > 0 && port <= 65535);
}

export function proxiesFromRegistry(text) {
  const match = text.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i);
  if (!match || !/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(text)) return [];
  return match[1].trim().split(';').flatMap(part => {
    if (part.includes('=') && !/^https?=/i.test(part)) return [];
    try { return [normalizeProxy(part.replace(/^https?=/i, ''))]; } catch { return []; }
  });
}

export async function discover({ manualProxy = '', platform = process.platform, appData = process.env.APPDATA, readFile = fs.readFile, run = exec, onWarning = () => {} } = {}) {
  if (manualProxy.trim()) return [{ url: normalizeProxy(manualProxy), source: '手动指定' }];
  const candidates = [];
  const add = (url, source) => { if (!candidates.some(item => item.url === url)) candidates.push({ url, source }); };
  // Read only the active core's HTTP/mixed port fields; never read subscriptions or credentials.
  const dirs = platform === 'win32'
    ? ['io.github.clash-verge-rev.clash-verge-rev', 'io.github.clash-verge-rev.clash-verge', 'io.github.clash-verge.clash-verge'].map(name => path.join(appData ?? path.join(os.homedir(), 'AppData', 'Roaming'), name))
    : [path.join(os.homedir(), '.config', 'io.github.clash-verge-rev.clash-verge-rev')];
  for (const dir of dirs) for (const file of ['clash-verge.yaml', 'config.yaml']) {
    try { for (const port of portsFromYaml(await readFile(path.join(dir, file), 'utf8'))) add(`http://127.0.0.1:${port}`, 'Clash Verge 配置'); }
    catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue;
      if (!candidates.length) throw new Error('无法读取 Clash Verge 端口配置，请检查文件权限。');
      onWarning('部分 Clash 配置读取失败，已保留此前发现的端口；本轮停止后续扫描。');
      return candidates.slice(0, 32);
    }
  }
  if (platform === 'win32') {
    try {
      const { stdout } = await run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { windowsHide: true, timeout: 4000, maxBuffer: 64 * 1024 });
      for (const url of proxiesFromRegistry(stdout)) add(url, 'Windows 当前用户代理');
    } catch (error) {
      onWarning('Windows 代理辅助读取失败，已保留此前发现的端口。');
      if (error.code === 'EACCES' || error.code === 'EPERM') return candidates.slice(0, 32);
    }
    // This is discovery only: never launch, stop or modify a VPN process.
    try {
      const script = "$cores = Get-Process -Name 'verge-mihomo','mihomo','clash-meta','clash' -ErrorAction SilentlyContinue; if ($cores) { Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in $cores.Id } | Select-Object -ExpandProperty LocalPort -Unique }";
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 6000, maxBuffer: 64 * 1024 });
      for (const line of stdout.split(/\s+/)) { const port = Number(line); if (Number.isInteger(port) && port > 0 && port <= 65535) add(`http://127.0.0.1:${port}`, 'Clash 内核监听端口'); }
    } catch (error) {
      onWarning('Clash 监听端口辅助读取失败，已保留此前发现的端口。');
    }
  }
  return candidates.slice(0, 32);
}
