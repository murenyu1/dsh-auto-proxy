# Git 与版本发布

`main` 保存稳定代码，开发分支使用 `codex/简短主题`。当前仓库仅在本地管理，远程仓库另行配置。

`package.json` 的版本、`CHANGELOG.md` 的对应条目和 Git 标签必须一致。兼容性修复使用补丁版本，新增兼容功能使用次版本，不兼容修改使用主版本。正式版本使用注解标签，例如 `v1.0.2`；已发布标签不移动。

## 发布步骤

先确认工作区干净，并完成代码评审。以下以补丁版本升级为例，在插件源码根目录的 PowerShell 中执行：

```powershell
git status --short
npm.cmd version patch --no-git-tag-version --ignore-scripts
```

更新 `CHANGELOG.md`、README 的安装包文件名及相关说明，然后运行检查：

```powershell
node --test tests/*.test.mjs
node --check client.js
node --check index.mjs
```

需要验证真实 DSH 网络或代理生命周期时，按 README 执行 `scripts/host-check.cjs`。宿主版本变化时应重新验证。

生成安装包及 SHA256：

```powershell
New-Item -ItemType Directory -Path downloads -Force | Out-Null
npm.cmd pack --ignore-scripts --pack-destination downloads --cache .npm-cache
$version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
$archive = "dsh-plugin-auto-proxy-$version.tgz"
$digest = (Get-FileHash -LiteralPath (Join-Path downloads $archive) -Algorithm SHA256).Hash.ToLowerInvariant()
"$digest  $archive" | Set-Content -LiteralPath "downloads/SHA256SUMS-$version" -Encoding ascii
```

检查包内文件并完成必要的打包后验证，然后提交、打标签：

```powershell
git add -A
git diff --cached --check
git diff --cached --stat
git commit -m "chore: release v$version"
git tag -a "v$version" -m "DSH Auto Proxy $version"
git status --short
```

源码、测试、文档和许可证进入 Git；`downloads/` 安装包和 `validation/` 运行日志／本机配置备份只保留在本地。发布到托管平台时，安装包及校验文件作为对应版本的 Release 附件上传。

新安装插件、更新用户 profile 和发布远程 Release 是独立操作，不会因执行 `npm pack` 或创建 Git 标签自动发生。每次安装前保留配置备份，不提交凭据或本机配置备份。
