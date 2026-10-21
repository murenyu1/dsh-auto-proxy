# DSH Clash Verge 自动代理插件

在 DSH 内开启开关并保存，自动发现 Clash Verge 本机 HTTP／混合代理端口，并接入已经运行的 DSH。无需开启 TUN 或全局模式，无需专用启动器。

适配并验证的宿主：Windows、DeepSeek Harness **0.2.1-rc.2**。当前使用的 Clash Verge 程序是 `D:\Program Files\Clash Verge\clash-verge.exe`，实测自动识别混合端口 **7897**。插件不会启动该程序；只要 Clash Verge 已运行并提供 HTTP 代理端口即可。代理软件内的规则决定后续线路，某个网站如果被其规则拒绝，插件无法代替它选择节点。

## 安装和使用

推荐在 DSH 插件管理页面通过“本地安装包”入口（如果该版本提供）选择 `downloads/dsh-plugin-auto-proxy-1.0.2.tgz`。也可在 PowerShell 中执行：

```powershell
& 'D:\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add 'D:\Projects\插件开发\dsh-auto-proxy\downloads\dsh-plugin-auto-proxy-1.0.2.tgz' --ignore-scripts
```

`desktop` 是 Windows 桌面版使用的 profile；其他部署请填实际 profile。安装命令只用于登记插件，不是日后启动 DSH 的入口。安装新插件是否需要宿主重新加载由 DSH 管理器决定；插件加载后，开关和代理切换不需要重启 DSH。

1. 正常启动 Clash Verge 和 DSH。
2. 在 DSH 插件管理中找到 **dsh-plugin-auto-proxy**，展开设置。
3. 勾选“开启自动代理”，点击“保存并应用”。地址留空表示自动检测。
4. 等待“已连接”和 GitHub HTTPS 检测成功，再让 DSH 抓取 GitHub 项目。
5. 识别失败时填写 `http://127.0.0.1:7897`，保存后重新检测。

关闭“开启自动代理”并保存，会恢复插件开启前 DSH 的代理策略。卸载也会清理入口及恢复策略。卸载操作交由 DSH 原生插件管理器处理。

## 实现与范围

1.0.2 修复辅助发现失败导致已解析端口丢失的问题：注册表或 PowerShell 读取失败会保留已有候选，并在状态卡片显示提示；注册表权限拒绝时停止后续辅助扫描。后续配置文件读取失败时同样保留已有候选。没有任何候选时不会假报已连接。关闭状态仍每秒检查开关变化，但不再重复清理或重建状态；默认关闭及用户已有启用选择均保持原样。

自动发现优先读取 Clash Verge 当前配置的 `mixed-port` / `port`，再读取已启用的 Windows 当前用户代理及 Clash 内核监听端口。不会探测没有已知配置或进程来源的常用端口。只接受无认证的本机 HTTP 代理；不把 SOCKS 端口或内核控制 API 当作代理。不会读取订阅内容用于联网或记录配置正文。

1.0.1 增加入口自循环保护：自己的入口及其 localhost／IPv6 别名不能成为上游；CONNECT 从 TCP 连接到完整响应头设置 10 秒绝对截止时间，静默或缓慢发送响应头的上游会收到 504 错误。入口仅监听本机，限制同时连接数，并拒绝带 Origin 的浏览器请求；它仍是本机 HTTP 代理，本机其他进程可能访问该端口，不是进程级网络隔离工具。

每个候选需要通过 HTTP CONNECT、TLS 证书验证和 GitHub HTTPS 响应检查。DSH 连接一个仅监听 `127.0.0.1` 的固定入口；后续 Clash 端口变化只改变入口的上游。已建立的连接继续使用原上游，VPN 断开时旧连接仍可能中断，需由调用方重试。代理不可用时拒绝新请求，不自动回退直连；显式 `NO_PROXY` 绕过仍按原设置生效。

插件调用宿主的 `installProxyFromEnvironment` 安装运行中策略，并通过其 `proxyRouteFor` 核对页面抓取路由。**原生 `web_fetch` 和普通 Node fetch** 已实测；模型请求、HTTP MCP 使用同一 DSH 全局 dispatcher 的路径会受此策略影响，但未执行收费模型调用或连接用户 MCP 作验收。

DSH 正常启动时未设置其他代理变量的情况下，新启动的命令子进程可继承插件入口。若启动时已有代理环境变量，DSH 原生 API 会保留它们给子进程；插件会显示提示。这种情况下不能保证 `git`、`gh` 或子进程 MCP 改用本插件入口。已经运行的子进程、独立浏览器、工作流 worker 和 PTC 不会被强制接管。

保留 DSH 的本机绕过、`NO_PROXY` 和原生网页私网访问限制。若 `NO_PROXY` 包含 `*` 或 GitHub，插件会报错提示而不是宣称 GitHub 已接入代理。状态接口由 DSH Connection 验证 Host、Origin 和连接认证。

不修改 `settings.json`、Windows 系统代理、Clash 配置、应用安装文件或证书策略；不解密 HTTPS，不记录请求正文，不包含启动 DSH 或监控 token 的功能。开关等插件设置通过 DSH 原生配置表单保存到其组合配置。

## 开发和验收

无需构建前端或下载宿主 SDK。宿主 peer 依赖标记为 optional，避免安装器下载另一份代理模块，运行时使用 DSH 原生包解析。

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

参见 [VALIDATION.md](VALIDATION.md) 查看测试范围及尚未验证的界面项目。

参考：[Codex 固定代理入口设计](https://github.com/SuiSuiNian721/codex-connection-monitor/blob/main/README-ProxyRouting.md)、[DSH 官方代理文档](https://deepseek-harness.github.io/deepseek-harness/guide/network-proxy)、[DSH 代理 API 源码](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/http-proxy/src/index.ts)。实现为独立编写。
