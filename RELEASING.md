# 发布与市场收录

当前待发布版本：1.0.6。先阅读 [VALIDATION.md](VALIDATION.md) 的已验证范围和限制。本地修复完成不等于已经公开发布或获市场收录。

## 公开仓库

公开源码仓库为 [murenyu1/dsh-auto-proxy](https://github.com/murenyu1/dsh-auto-proxy)，默认分支为 `main`。仓库已添加 `dsh-plugin` topic，源码和参考致谢已推送。

`package.json` 已声明实际 `repository`、`homepage` 与问题反馈地址。后续迁移仓库时同步更新这些字段并重新验证打包产物；这是 npm 包与社区仓库自动关联的依据。

源码、测试、README、CHANGELOG、VALIDATION、RELEASING 和 MIT 许可证进入 Git。`downloads/`、`validation/`、缓存及本机备份被忽略，不应上传整个工作目录。

## 验证与打包

在源码目录运行：

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
git diff --check
New-Item -ItemType Directory -Path downloads -Force | Out-Null
npm.cmd pack --ignore-scripts --pack-destination downloads --cache .npm-cache
```

真实宿主及解包验证方法见 README；验收时 `scripts/host-check.cjs --package-root` 后必须传入解包后的 `package` 目录。该脚本同时从该目录加载控制器和插件入口，不混用源码副本。

生成校验文件：

```powershell
$version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
$archive = "dsh-plugin-auto-proxy-$version.tgz"
$digest = (Get-FileHash -LiteralPath (Join-Path downloads $archive) -Algorithm SHA256).Hash.ToLowerInvariant()
"$digest  $archive" | Set-Content -LiteralPath "downloads/SHA256SUMS-$version" -Encoding ascii
```

正式公开发布前，在 DSH 原生插件管理器中安装这个包，实际检查开关保存、状态更新、关闭恢复及卸载，并将结果补入 VALIDATION。桌面应用运行期间由应用管理自己的 profile，不用 CLI 强行修改其依赖。安装及发布不需要修改 `settings.json`。

## 提交与版本

提交前检查差异和待提交文件；提交说明使用中文。版本号、版本文档及标签一致，已公开标签不移动。确认暂存区仅含本轮预期文件后再提交：

```powershell
git diff --cached --check
git diff --cached --stat
git commit -m "chore(release): 完善文档文案并完成 1.0.6 市场发布前校验"
git tag -a v1.0.6 -m "自动代理插件 1.0.6"
```

发布操作须分别检查提交、远程分支、标签和 Release；仅生成 tgz 不会发布它。后续使用当前实际分支推送，不覆盖远程已有历史。

## 发布来源

推荐将 `dsh-plugin-auto-proxy-1.0.6.tgz` 和 `SHA256SUMS-1.0.6` 作为 GitHub `v1.0.6` Release 附件。它们已包含运行所需代码，无需安装期间构建。提交市场条目时，tarball 使用固定标签的 HTTPS 地址：

```text
https://github.com/murenyu1/dsh-auto-proxy/releases/download/v1.0.6/dsh-plugin-auto-proxy-1.0.6.tgz
```

每次发布后都要验证下载与本地 SHA256 一致。不要把带版本文件名放到 `releases/latest/download/`，否则下次发版后链接可能失效。

也可在 npm 确认包名归属并登录后，发布同一份已经验证的 tgz。公开发布前补齐实际 `repository`；包名可用性、账号权限和发布是否成功必须分别确认。不要运行依赖缓存或日志中的不明命令。

## dshmarket 社区目录

本机安装的 `dshmarket` 使用 [awesome-dsh-plugin 社区目录](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。它的 [贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) 要求：公开仓库创建满 1 天、添加 `dsh-plugin` topic、具有可安装的 `dsh.bundle`、真实可用的实现和准确描述。维护者仍会审核源码及是否与现有条目重复。

仓库创建时间为北京时间 **2026-10-22 03:25:23**，满足满 1 天条件的时间为 **2026-10-23 03:25:23**。当前已完全满足满 1 天要求。

条件满足且 Release 附件可下载后，向该目录添加一个文件 `data/plugins/murenyu1__dsh-auto-proxy.yml` 并提 PR，不手工修改自动生成的 README。以下是待提交的条目：

```yaml
url: https://github.com/murenyu1/dsh-auto-proxy
name: murenyu1/dsh-auto-proxy
category: dev
description:
  en: Connects DSH to local HTTP proxies automatically via a loopback relay. No TUN, no env vars, zero-restart switching, with sidebar/composer dock controls and live topology.
  zh: DSH 自动代理：自动识别本机代理端口，固定本地入口无感热切换，免 TUN、免改环境变量、无需重启 DSH。支持侧栏、底栏工作台与输入框胶囊一键启停，内嵌链路拓扑图。
tarball: https://github.com/murenyu1/dsh-auto-proxy/releases/download/v1.0.6/dsh-plugin-auto-proxy-1.0.6.tgz
```

目前尚未提交目录 PR。合并和收录时间由目录维护者及其流水线决定。

## DSH 原生自定义市场

原生“发现”页也可使用社区目录提供的 format-1 索引；自建索引则按照 [DSH 官方格式](https://deepseek-harness.github.io/deepseek-harness/guide/plugin-market) 声明实际发布的 npm 或 Git 来源，`engines.dsh` 与包保持一致。原生索引的 source 不能用本地 tgz 路径代替 npm/Git 来源。
