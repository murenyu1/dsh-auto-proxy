# 发布与市场收录

当前待发布版本：1.0.4。先阅读 [VALIDATION.md](VALIDATION.md) 的已验证范围和限制。本地修复完成不等于已经公开发布或获市场收录。

## 公开仓库

用户 GitHub 账号为 `murenyu1`，建议仓库名沿用 `dsh-auto-proxy`，拟使用 `https://github.com/murenyu1/dsh-auto-proxy`。截至本次验收，用户确认尚未创建仓库；本文中的地址是发布准备，不是已经可用的下载源。

创建公开仓库后，为仓库添加 `dsh-plugin` topic。将 `package.json` 的 `repository` 与 `homepage` 设置为实际创建的仓库地址，再重新打包和校验；这是 npm 包与社区仓库自动关联的依据。若实际仓库名称不同，使用真实地址，不提交占位 URL。

源码、测试、README、CHANGELOG、VALIDATION、RELEASING 和 MIT 许可证进入 Git。`downloads/`、`validation/`、缓存及本机备份被忽略，不应上传整个工作目录。

## 验证与打包

在源码目录运行：

```powershell
node --test tests/*.test.mjs
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
git commit -m "修复代理转发异常并完成 1.0.4 发布前验证"
git tag -a v1.0.4 -m "自动代理插件 1.0.4"
```

本轮修复不会自动创建 Git 标签、推送仓库或发布外部资源。后续使用当前实际分支配置远程并推送，不覆盖远程已有历史。

## 发布来源

推荐将 `dsh-plugin-auto-proxy-1.0.4.tgz` 和 `SHA256SUMS-1.0.4` 作为 GitHub `v1.0.4` Release 附件。它们已包含运行所需代码，无需安装期间构建。提交市场条目时，tarball 使用固定标签的 HTTPS 地址：

```text
https://github.com/murenyu1/dsh-auto-proxy/releases/download/v1.0.4/dsh-plugin-auto-proxy-1.0.4.tgz
```

上述地址只有在真实仓库、标签、Release 和附件创建后才有效。不要把带版本文件名放到 `releases/latest/download/`，否则下次发版后链接可能失效。

也可在 npm 确认包名归属并登录后，发布同一份已经验证的 tgz。公开发布前补齐实际 `repository`；包名可用性、账号权限和发布是否成功必须分别确认。不要运行依赖缓存或日志中的不明命令。

## dshmarket 社区目录

本机安装的 `dshmarket` 使用 [awesome-dsh-plugin 社区目录](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。它的 [贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) 要求：公开仓库创建满 1 天、添加 `dsh-plugin` topic、具有可安装的 `dsh.bundle`、真实可用的实现和准确描述。维护者仍会审核源码及是否与现有条目重复。

仓库和 Release 就绪后，向该目录添加一个文件 `data/plugins/murenyu1__dsh-auto-proxy.yml` 并提 PR，不手工修改自动生成的 README。以下是按拟定仓库名准备的条目，提交前逐项验证 URL：

```yaml
url: https://github.com/murenyu1/dsh-auto-proxy
name: murenyu1/dsh-auto-proxy
category: dev
description:
  en: Detects local HTTP proxies and routes DSH requests through a fixed loopback relay, with a settings toggle and GitHub HTTPS checks. Requires DSH 0.2.1-rc.2.
  zh: 检测本机 HTTP 代理，通过固定回环入口转发 DSH 请求，提供设置开关和 GitHub HTTPS 检测。需要 DSH 0.2.1-rc.2。
tarball: https://github.com/murenyu1/dsh-auto-proxy/releases/download/v1.0.4/dsh-plugin-auto-proxy-1.0.4.tgz
```

这些是发布准备材料，尚未提交目录 PR。合并和收录时间由目录维护者及其流水线决定。

## DSH 原生自定义市场

原生“发现”页也可使用社区目录提供的 format-1 索引；自建索引则按照 [DSH 官方格式](https://deepseek-harness.github.io/deepseek-harness/guide/plugin-market) 声明实际发布的 npm 或 Git 来源，`engines.dsh` 与包保持一致。原生索引的 source 不能用本地 tgz 路径代替 npm/Git 来源。
