# Jiva 兴趣入口：GitHub 项目调研

核查日期：2026-11-02。来源范围：官方 GitHub README、功能文档、依赖声明和 LICENSE。未安装运行、未测中文输出质量、费用或延迟。

## 判断

优先参考 Open Notebook 的后台 Transformations 与 Podcastfy 的音频管线；DeepTutor 可参考深入教学，SurfSense 可参考桌面本地文档架构。当前检查的四个项目，没有在已查文档中完整强调“兴趣可以停留、不催任务、按投入意愿渐进展开”的闭环。这不是对整个 GitHub 不存在同类产品的断言。

核心可借鉴顺序：材料进入 → 准备带出处的轻量解释 → 随便看看或听一点 → 用户选择深入 → 留下个人线索 → 再次接上。

## 1. Open Notebook：最接近有人先替你准备

- [官方仓库](https://github.com/lfnovo/open-notebook)
- [Transformations 文档](https://github.com/lfnovo/open-notebook/blob/main/docs/3-USER-GUIDE/transformations.md)
- [MIT 许可证](https://github.com/lfnovo/open-notebook/blob/main/LICENSE)
- [Python 依赖](https://github.com/lfnovo/open-notebook/blob/main/pyproject.toml)、[前端依赖](https://github.com/lfnovo/open-notebook/blob/main/frontend/package.json)

材料导入时选择 Transformations，抽取文本后后台执行，产物作为 source insights，可用于聊天、搜索或播客摘要模式。支持多种来源、材料对话与音频。

值得借鉴的是 source → insight → conversation/audio 的链条。可把转换模板改成“为什么值得了解 / 一个生活切口 / 短讲解 / 来源与不确定性”，而不是只生成长摘要。

差距：笔记本、来源和聊天仍要求用户主动组织参与；没有确认具备完整时效核查和针对个人的价值筛选。自动提取不能被包装成事实核验。

采用成本推断为中等：Python/FastAPI、Next.js/React、SurrealDB，加上模型和 embedding；可研究 REST API 适配。当前播客依赖是 podcast-creator，不能因 Podcastfy 的历史介绍就断言它当前使用 Podcastfy。

## 2. Podcastfy：适合先听一点

- [官方仓库与功能说明](https://github.com/souzatharsis/podcastfy)
- [Apache-2.0 许可证](https://github.com/souzatharsis/podcastfy/blob/main/LICENSE)

Python 库，可将 URL、PDF、文本和视频等转为对话式音频，支持讲稿、语言、风格、结构等定制。它支持短音频，但不能据此保证任意内容都会被压缩成正确的一分钟讲解。

适合作为独立能力：先准备核验过的短稿，再送入音频模块。用户无需先想出问题，就能听一段解释。

差距：音频表达不等于事实核查、过时信息筛选或学习记忆。生成流畅不保证准确。

采用成本推断低到中等：Python、FFmpeg、LLM 与 TTS 配置。中文声音、生成时延和费用均需实际试用后决定。本 demo 只使用浏览器朗读，没有接入 Podcastfy。

## 3. DeepTutor：深入学习阶段的参考

- [官方 README](https://github.com/HKUDS/DeepTutor/blob/main/README.md)
- [Apache-2.0 许可证](https://github.com/HKUDS/DeepTutor/blob/main/LICENSE)
- [模块与 Python 依赖](https://github.com/HKUDS/DeepTutor/blob/main/pyproject.toml)、[前端依赖](https://github.com/HKUDS/DeepTutor/blob/main/web/package.json)

当前功能涵盖问答、测验、研究、可视化、阅读与掌握路径，支持材料引用和连续上下文。可以研究原文与解释并排、基于概念的引导和记忆机制。

差距：当前范围还包含 Task Board、Calendar、进度和练习等，整体套用可能把兴趣变成另一套任务工作台。

采用成本推断较高：Python、Next.js/React、多种解析和检索模块及模型配置。提供 Docker，依赖已模块化，但本轮未验证单模块可独立使用的稳定接口。

## 4. SurfSense：同一材料的多种产物

- [当前官方 README](https://github.com/MODSetter/SurfSense)
- [Community Local 架构](https://github.com/MODSetter/SurfSense/blob/main/surfsense_local/README.md)
- [Apache-2.0 许可证](https://github.com/MODSetter/SurfSense/blob/main/LICENSE)

当前 README 重心已经是本地文档桌面 agent，不应沿用旧博客对 Web 应用和连接器的介绍。资料导入、引用检索与 Studio 产物让同一来源可以转成摘要、播客等不同入口。

值得借鉴原文保留、引用回查、来源选择，以及 ingestion 和 Studio 分队列，避免重导入堵住轻量交互。

差距：偏文档研究、生成和编辑；不是直接的兴趣陪伴产品。部分官方 Web Crawl / Search 插件需要独立 SurfSense license，代码许可证不能被理解为所有服务免费。

采用成本推断较高：Electron、Vite/React、Python/FastAPI、Huey、SQLite、Docling、llama.cpp，本地音频开发还涉及 C++ 工具链。

## 对 Jiva 的实施判断

先验证薄层体验，暂不引入整套框架。以现有内容为源，输出短讲解、引用与待核验项；是否进一步解释或练习由用户选择。若验证有效，再评估独立的生成接口、后台任务和持久化。

真实后端需要新增的工作包括：来源版本记录、分段引用、生成任务状态、时效与真实性核验依据、失败重试、模型连接、个人上下文边界。以上尚未在这个 demo 实现，也不在本轮直接接入正式产品。

成功信号应来自用户是否自然愿意了解一点、是否觉得内容可靠和入口轻松，不应仅以页面停留、收藏量或连续打卡衡量。

## fq-book 内容依据

- [目录](https://github.com/hoochanlon/fq-book/blob/master/docs/_sidebar.md)
- [DNS 入口](https://github.com/hoochanlon/fq-book/blob/master/docs/dns%26hosts/dns.md)
- [代理入口](https://github.com/hoochanlon/fq-book/blob/master/docs/abc/proxy-s-x.md)
- [证书入口](https://github.com/hoochanlon/fq-book/blob/master/docs/abc/dc_zhenshu.md)
- [MDN DNS](https://developer.mozilla.org/en-US/docs/Glossary/DNS)
- [MDN Proxy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Proxy_servers_and_tunneling)
- [MDN TLS](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Transport_Layer_Security)

短讲解独立编写。原仓库 README 对 DNS 发送根证书的解释混淆了 DNS 与 TLS 证书验证，因此不能直接照搬原书文字；未据此推断所有基础内容都正确或所有教程都过时。作者前言包含非商用声明，商业产品如复用原文需要额外核对各篇授权。
