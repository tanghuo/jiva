# 工作台引擎

侧栏“Agent 工作台”是唯一的 Agent 入口，默认启用。在输入框旁选择 Grok、Codex 或 Antigravity，并读取当前账号可用的模型。模型与推理强度按会话保存。连接失败不会自动登录、换引擎或重发任务。

Grok 程序路径和默认模型在“设置 → Agent 连接”配置，先在终端执行 grok login。Codex 使用本机 CLI 及其凭据；Antigravity 在模型菜单明确连接账号。各引擎的文件访问、审批和应用工具支持不同，详见 [工作台指南](agent-workbench-usage.md)。

内容库资料可放进资料篮，点击“问 Agent”创建工作台 Wiki 助手草稿。旧聊天模块、历史会话与 API 已移除；schema 46 清理旧记录，已保存进 Wiki 的成果保留。
