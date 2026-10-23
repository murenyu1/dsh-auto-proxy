<div align="center">
  <h1>dsh-plugin-auto-proxy</h1>
  <p><b>让 DeepSeek Harness 自动走本机 HTTP／混合代理，免配 TUN 虚拟网卡，免改环境变量，免重启 DSH</b></p>

  <a href="https://github.com/deepseek-ai/deepseek-harness"><img alt="DSH 0.2.1-rc.2" src="https://img.shields.io/badge/DSH-0.2.1--rc.2-4d6bfe?style=flat-square" /></a>
  <a href="https://nodejs.org"><img alt="Node >=22.21" src="https://img.shields.io/badge/Node-%3E%3D22.21-339933?style=flat-square" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" /></a>
  <a href="https://github.com/murenyu1/dsh-auto-proxy"><img alt="Version 1.0.6" src="https://img.shields.io/badge/Version-1.0.6-blue?style=flat-square" /></a>
</div>

---

装在 DeepSeek Harness 里的自动代理插件。打开开关，DSH 就能直接走本机代理顺畅拉取 GitHub 资源、网页与模型，不用开 TUN 全局网卡，不用到处配环境变量，代理变动时也**不用重启 DSH**。

## 💡 解决什么问题

日常在本地开着 Clash Verge 或其他代理软件时，DSH 经常无法直接走代理，导致 GitHub 插件安装、网页搜索和模型请求频繁超时：
- **开 TUN 太重**：全局虚拟网卡容易造成系统路由混乱、本地回环冲突，影响其他开发工具。
- **配环境变量太麻烦**：手动配 `HTTP_PROXY` 不仅繁琐，而且一旦代理软件重启或端口变了（比如从 7897 变成 7890），就必须把 DSH 整个重启一遍。
- **本插件的做法**：在 DSH 里点一下开关，自动找到本机代理端口并完成桥接。代理软件换端口、重连节点，DSH 在后台无感续连，界面不卡顿、进程不重启。

## ✨ 你会得到

- **自动认端口**——优先读取 Clash Verge 当前配置的 `mixed-port` / `port`（如 `7897`），辅助识别 Windows 系统代理与内核监听端口；也支持手动填入特定端口。
- **零重启热切换**——不管代理软件如何重启、换节点，DSH 内部通道始终保持稳定，后台自动重连，无需重启 DSH。
- **四处都能点**——哪顺手就在哪操作，全局实时同步：
  - **右侧边栏**：完美接入 `dsh-better-sidebar` 与原生右侧栏，提供完整的代理控制台。
  - **底部工作台**：支持停靠在 BetterSidebar 底部工作台，与侧边栏完全等价。
  - **对话框底部胶囊**：在聊天输入框正下方常驻精致状态小胶囊（`[ 🌐 自动代理: 127.0.0.1:7897 ● 已连接 ]`），点击一键启停。
  - **插件设置卡片**：标准的 DSH 设置面板集成。
- **链路一眼看清**——内置 Primer 风格的紧凑拓扑图：`DSH 入口 ➔ 本机代理 ➔ 外部网络`。绿了就是通了，GitHub HTTPS 连通状态一目了然。
- **干净恢复，不留后患**——关掉开关或卸载插件，立即 100% 恢复 DSH 原来的网络策略与环境变量，绝不在系统里残留任何脏配置。
- **严格保护隐私**——只读端口数字，订阅链接、节点密码、分流规则一概不读不存；无任何第三方遥测上报；本地中继仅监听 `127.0.0.1` 并主动拦截网页跨站 Origin 请求，杜绝恶意网站探测本地内网。

## 🏛️ 设计思路与致谢

本插件的核心路由架构参考了 **SuiSuiNian721 的 [codex-connection-monitor](https://github.com/SuiSuiNian721/codex-connection-monitor)**（特别是其 [README-ProxyRouting.md](https://github.com/SuiSuiNian721/codex-connection-monitor/blob/main/README-ProxyRouting.md)）：

> **“固定本地入口，动态切换上游”**：
> 插件在 DSH 内部只启动一个仅监听 `127.0.0.1` 随机端口的轻量中继，DSH 原生请求全部指向这个固定入口。背后由中继动态探测并转发给真实的代理端口。当外部代理端口改变时，只需改变中继的转发目标，DSH 的内部网络栈完全不受影响。

非常感谢 **SuiSuiNian721** 及其贡献者开源这一优雅的设计！详细的参考说明见 [参考与致谢 (ACKNOWLEDGEMENTS.md)](ACKNOWLEDGEMENTS.md)。

## 🚀 安装与使用

### 官方 DSH Desktop 桌面端（推荐）
在 DSH 桌面端的 **设置 → 插件** 中，通过“本地安装包”选择 `dsh-plugin-auto-proxy-1.0.6.tgz` 安装即可。

### 命令行部署（Web Profile）
在安装包所在目录执行：
```sh
dsh plugin --profile web add ./dsh-plugin-auto-proxy-1.0.6.tgz --ignore-scripts
```
安装后硬刷新浏览器页面（`Ctrl + F5` 或 `Cmd + Shift + R`）。

### 使用步骤
1. 正常打开你的代理软件（如 Clash Verge）。
2. 在 DSH 任意入口（侧边栏、底栏工作台、输入框底部胶囊或插件配置）打开**“开启自动代理”**。
3. 拓扑图变绿显示“已连接”，即可正常使用。

## ⚠️ 边界与限制

- **支持的软件**：仅支持提供本机 HTTP／混合代理端口的软件（如 Clash Verge、Mihomo、v2rayN 等）。纯 SOCKS 端口或仅有全局 TUN 虚拟网卡而未开放 HTTP 端口的软件无法接入。
- **宿主版本**：已在 DeepSeek Harness **0.2.1-rc.2**（Node 22.21+）完整验证。
- **规则决定出口**：插件只负责把流量送进本机代理端口，具体某个网址走哪个节点、是否被代理规则拦截，由你自己的代理软件规则决定。

## 🛠️ 开发与本地测试

```powershell
node -e "
async function run() {
  await import('./tests/discovery-fallback.test.mjs');
  await import('./tests/proxy.test.mjs');
  await import('./tests/security.test.mjs');
  await import('./tests/plugin.test.mjs');
}
run();
"
node --check client.js
node --check index.mjs
npm.cmd pack --ignore-scripts --pack-destination downloads --cache .npm-cache
```

详细的检测记录见 [VALIDATION.md](VALIDATION.md)，发布流程见 [RELEASING.md](RELEASING.md)。
