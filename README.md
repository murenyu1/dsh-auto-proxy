# DSH 自动代理插件

在 DSH 内开启开关并保存，发现本机 HTTP／混合代理端口，并接入已经运行的 DSH。无需开启 TUN 或全局模式，无需专用启动器。

本插件参考了 **SuiSuiNian721 的 [codex-connection-monitor](https://github.com/SuiSuiNian721/codex-connection-monitor)**，特别是其“固定本地代理入口、动态切换上游”的设计思路。感谢原作者及贡献者。本插件面向 DSH 的插件生命周期、原生代理 API 和设置面板进行适配，参考范围见 [参考与致谢](ACKNOWLEDGEMENTS.md)。

当前版本 **1.0.5**，支持的宿主版本限定为已验证的 DeepSeek Harness **0.2.1-rc.2**，运行环境为 Node **22.21+**；真实宿主联网验收在 Windows 完成。已实测从 Clash Verge 配置自动识别混合端口 **7897**。其他代理软件可以通过已启用的 Windows 本机系统代理设置被发现，或手动填写其 HTTP／混合代理地址；未验证所有软件的专有配置格式。插件不会启动代理软件。代理软件内的规则决定后续线路，某个网站如果被其规则拒绝，插件无法代替它选择节点。仅提供 SOCKS 端口或 VPN 隧道、没有 HTTP／混合代理端口的软件不能直接接入。

## 安装和使用

推荐在 DSH 插件管理页面通过“本地安装包”入口（如果该版本提供）选择 `dsh-plugin-auto-proxy-1.0.5.tgz`。源码 checkout 生成的包位于 `downloads/`；下载 Release 附件后使用实际保存位置。

对于使用 CLI 管理的部署，在安装包所在目录执行（将 `web` 换为实际 profile）：

```powershell
dsh plugin --profile web add ./dsh-plugin-auto-proxy-1.0.5.tgz --ignore-scripts
```

官方桌面版的 profile 由应用管理，请优先使用应用内安装入口。安装命令只用于登记插件，不是日后启动 DSH 的入口。安装新插件是否需要宿主重新加载由 DSH 管理器决定；插件加载后，开关和代理切换不需要重启 DSH。

### 功能入口与多端协同

插件支持以下多种便捷入口，所有入口通过内部 `ProxyStateHub` 全局单例总线保持实时状态同步，在任意位置操作均可即时反映到全界面：

1. **右侧边栏（Right Sidebar）**：
   - 在安装了 `dsh-better-sidebar` 的环境中，点击右侧标签栏上的“🌐 自动代理”图标，即可展开完整的功能控制台与网络拓扑。
   - 在未安装 BetterSidebar 的原生 DSH 环境中，同样提供原生侧栏选项卡支持。
2. **下侧边栏与底部工作台（Bottom Workbench）**：
   - BetterSidebar 的底部面板原生支持直接打开或将“自动代理”页签停靠在底部工作台，与右侧栏保持完全一致的功能与设置。
3. **对话框底部环境胶囊（Composer Dock）**：
   - 对话输入框正下方常驻显示紧凑的代理状态胶囊（例如 `[ 🌐 自动代理: 127.0.0.1:7897 ● 已连接 ]`）。
   - 点击胶囊即可一键切换启停代理，无需离开对话界面。
4. **插件管理设置页面（Plugins Config）**：
   - 在 DSH 插件管理中找到 **dsh-plugin-auto-proxy**，展开配置卡片，提供完整的美化配置界面。

### 快速开始

1. 正常启动代理软件和 DSH。
2. 在任意入口（右侧边栏、下侧工作台、底部胶囊或插件设置卡片）开启“自动代理”。
3. 状态自动同步并显示“已连接”，拓扑图直观展示 `DSH 入口 ➔ 本机代理 ➔ 外部网络` 的链路连通情况。
4. 如需指定特定端口，可在设置区域填入手动地址（例如 `http://127.0.0.1:7897`），点击保存即可立即生效。

关闭“开启自动代理”并保存，会恢复插件开启前 DSH 的代理策略。卸载也会清理入口及恢复策略。卸载操作交由 DSH 原生插件管理器处理。

## 实现与范围

1.0.5 增加右侧边栏、底部工作台和对话框底部胶囊多通道接入；实现全局单例状态总线，多面板实时双向同步无冲突；重构现代化前端设计，自适应 DSH 官方深浅色主题，提供直观的链路拓扑图。

1.0.4 修复普通 HTTP 响应中途断开造成下游持续等待的问题，补充响应头绝对超时、取消清理、异常升级响应处理及双方逐跳头过滤。前后端均接受默认 HTTP 端口 80（省略端口同样表示 80）。状态请求保留部署子路径，并设有 10 秒截止时间，避免一次挂起请求阻断后续轮询。

1.0.2 修复辅助发现失败导致已解析端口丢失的问题：注册表或 PowerShell 读取失败会保留已有候选，并在状态卡片显示提示；注册表权限拒绝时停止后续辅助扫描。后续配置文件读取失败时同样保留已有候选。没有任何候选时不会假报已连接。关闭状态仍每秒检查开关变化，但不再重复清理或重建状态；默认关闭及用户已有启用选择均保持原样。

自动发现优先读取 Clash Verge 当前配置的 `mixed-port` / `port`，再读取已启用的 Windows 当前用户代理及 Clash 内核监听端口。不会探测没有已知配置或进程来源的常用端口。只接受无认证的本机 HTTP 代理；不把 SOCKS 端口或内核控制 API 当作代理。不会读取订阅内容用于联网或记录配置正文。

1.0.1 增加入口自循环保护：自己的入口及其 localhost／IPv6 别名不能成为上游；CONNECT 从 TCP 连接到完整响应头设置 10 秒绝对截止时间，静默或缓慢发送响应头的上游会收到 504 错误。入口仅监听本机，限制同时连接数，并拒绝带 Origin 的浏览器请求；它仍是本机 HTTP 代理，本机其他进程可能访问该端口，不是进程级网络隔离工具。

每个候选需要通过 HTTP CONNECT、TLS 证书验证和 GitHub HTTPS 响应检查。DSH 连接一个仅监听 `127.0.0.1` 的固定入口；后续代理端口变化只改变入口的上游。已建立的连接继续使用原上游，VPN 断开时旧连接仍可能中断，需由调用方重试。代理不可用时拒绝新请求，不自动回退直连；显式 `NO_PROXY` 绕过仍按原设置生效。

插件调用宿主的 `installProxyFromEnvironment` 安装运行中策略，并通过其 `proxyRouteFor` 核对页面抓取路由。**原生 `web_fetch` 和普通 Node fetch** 已实测；模型请求、HTTP MCP 使用同一 DSH 全局 dispatcher 的路径会受此策略影响，但未执行收费模型调用或连接用户 MCP 作验收。

DSH 正常启动时未设置其他代理变量的情况下，新启动的命令子进程可继承插件入口。若启动时已有代理环境变量，DSH 原生 API 会保留它们给子进程；插件会显示提示。这种情况下不能保证 `git`、`gh` 或子进程 MCP 改用本插件入口。已经运行的子进程、独立浏览器、工作流 worker 和 PTC 不会被强制接管。

保留 DSH 的本机绕过、`NO_PROXY` 和原生网页私网访问限制。若 `NO_PROXY` 包含 `*` 或 GitHub，插件会报错提示而不是宣称 GitHub 已接入代理。状态接口由 DSH Connection 验证 Host、Origin 和连接认证。

不修改 `settings.json`、Windows 系统代理、Clash 配置、应用安装文件或证书策略；不解密 HTTPS，不记录请求正文，不包含启动 DSH 或监控 token 的功能。开关等插件设置通过 DSH 原生配置表单保存到其组合配置。

## 开发和验收

无需构建前端或下载宿主 SDK。宿主 peer 依赖标记为 optional，运行时使用 DSH 原生包解析。版本升级前应重新核对宿主 API 和兼容性，不通过安装另一份代理模块解决宿主不兼容问题。

```powershell
node --test tests/*.test.mjs
node --check client.js
npm.cmd pack --ignore-scripts --pack-destination downloads --cache .npm-cache
```

真实宿主隔离验证（在独立 Node 模式进程中运行，不修改日常 DSH 实例及用户环境）：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& 'D:\Programs\DeepSeek Harness\DeepSeek Harness.exe' --expose-internals .\scripts\host-check.cjs 'D:\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules' --clean-proxy-env
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

去掉 `--clean-proxy-env` 可检查保留已有启动代理时的提示与恢复行为。测试使用真实 DSH `PluginPackages` 解析依赖与 `HttpFetchProvider` 抓取，不替换网络实现。

参见 [VALIDATION.md](VALIDATION.md) 查看本次检测结果、测试范围及尚未验证的界面项目。这里只证明本地测试结果；公开发布及市场收录尚需按照发布指南完成。

版本记录见 [CHANGELOG.md](CHANGELOG.md)，Git 分支、标签和发布步骤见 [RELEASING.md](RELEASING.md)。

参考：[Codex 固定代理入口设计](https://github.com/SuiSuiNian721/codex-connection-monitor/blob/main/README-ProxyRouting.md)、[DSH 官方代理文档](https://deepseek-harness.github.io/deepseek-harness/guide/network-proxy)、[DSH 代理 API 源码](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/http-proxy/src/index.ts)。详细说明见 [参考与致谢](ACKNOWLEDGEMENTS.md)。
