# Agent 聊天文件附件

新建任务和已有会话统一支持文件选择、拖入、粘贴。普通文本粘贴保留浏览器默认行为；文件事件由聊天框消费，避免冒泡至 Wiki 导入。

沿用 agent_artifacts 和会话引用、草稿、轮次 artifactIds，不新增表。上传接口保留原图片请求兼容；文件名通过 URL 编码的 x-attachment-name 传递，仅作展示元数据。原始字节按哈希和随机标识保存，保留安全后缀供原生工具识别；不解析 PDF、Office 或代码，不转码、不截断。

每轮最多 8 个附件、每个最多 25 MiB。图片沿用现有 PNG/JPEG/WebP 图片输入。其他文件存储为 file，下载时以 application/octet-stream 返回（PDF 使用 application/pdf），避免将上传内容作为可执行网页提供。模型能否读取由实际引擎及其工具决定。

Grok Build 与 Antigravity 通过 ACP resource_link 传递实际可访问的 file URI、原始文件名、MIME 和大小；Codex app-server 没有通用文件输入，使用独立 text 块传递文件名、路径等引用元数据，由原生文件工具读取（mention 用于应用和插件，不用于文件）。应用不添加文件内容到提示词，不承诺模型具有任意格式解析能力。

会话归属与内容哈希校验后才向引擎交付引用。Grok 文件网关额外允许读取本轮显式附件的精确路径，不授予存储目录或其他会话文件读取权限；写入权限不扩张。PDF 等二进制格式由引擎的原生工具处理，已有文本读取网关仍仅接受 UTF-8 文本。受限 Wiki/工作流会话无原生文件访问，文件附件明确拒绝派发；旧文字产物继续使用原有文本引用机制。

批量上传逐个持久化草稿引用，失败保留成功部分。新任务上传失败保留会话和已有草稿，提示重新添加失败及尚未上传文件。图片能力限制只阻止图片，普通文件仍可添加。

验证：两种聊天入口和三种添加方式；原始 PDF/代码字节保存与下载；ACP 引用及 Codex 路径输入格式；普通文本粘贴不被拦截；附件大小、数量和会话隔离；原有图片与工作流回归。

协议依据：[ACP resource_link](https://agentclientprotocol.com/protocol/v1/content#resource-link)；[Codex UserInput 定义](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/user_input.rs)。
