# 参考与致谢

本插件参考了 **SuiSuiNian721** 的 [codex-connection-monitor](https://github.com/SuiSuiNian721/codex-connection-monitor)。感谢原作者及贡献者公开其设计与实现资料。

主要参考资料为 [README-ProxyRouting.md：Codex 固定代理入口](https://github.com/SuiSuiNian721/codex-connection-monitor/blob/main/README-ProxyRouting.md)。参考的设计包括：

- 通过固定本地代理入口接入应用，在入口后切换当前本机 HTTP 代理。
- 上游变化影响新连接，已经建立的 TCP 连接继续使用原上游。
- 代理不可用时拒绝新连接，不自动回退直连。
- 保留系统代理和代理软件自身的配置，不通过解密 HTTPS 实现转发。

本插件将这些设计思路用于 DeepSeek Harness：使用 DSH 原生代理 API、Cordis 生命周期和配置表单，提供本机代理发现、GitHub HTTPS 检测、状态卡片及启停恢复。上游项目面向 Codex；本插件的宿主适配、功能范围和验证结果以本仓库 README 与 VALIDATION 为准。

本说明用于明确参考来源和致谢，不代表上游作者对本插件的维护、审核或背书。上游内容的许可证信息请查阅其 [licenses 目录](https://github.com/SuiSuiNian721/codex-connection-monitor/tree/main/licenses)；本说明不对上游许可类型作出声明。本项目的许可证见 [LICENSE](LICENSE)。
