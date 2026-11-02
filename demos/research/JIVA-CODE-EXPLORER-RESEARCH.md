# Jiva 代码项目视图：先复用，再集成

调研日期：2026-11-02。当前阶段为候选调研和集成路线比较，尚未选定或接入完整引擎。旧的“讲解卡片”demo 不应作为代码项目界面的基础。

## 用户目标

快速了解 Jiva 或其他代码项目：项目全貌、架构、脑图、目录结构、执行路径，并提供类似 SourceTree 的简化 Git 图形界面。已有兴趣是代码项目本身，不应额外编排成学习课程。

优先采用已有工具或组件。Jiva 当前使用 Electron、React 19、Node 24、SQLite，已依赖 React Flow（@xyflow/react）。因此 React 组件或可本地运行的 Node 工具，比原生 Qt 应用整体迁入更适合作为集成候选。

## 视图需要分别回答的问题

| 视图 | 问题 | 数据依据 |
| --- | --- | --- |
| 项目总览 | 项目做什么、怎样启动、主要组成是什么 | README、package.json、入口代码 |
| 架构图 | 模块怎样依赖、数据经过哪几层 | 源码 import、模块接口、服务装配关系 |
| 功能脑图 | 项目提供哪些能力、每项能力对应哪些实现 | 概念分组和对应文件；人工/AI 归纳应能核对 |
| 目录结构 | 文件在哪里、谁引用它、可以怎样定位 | 实际文件树与解析得到的依赖关系 |
| 执行路径 | 一次动作从入口经过哪些函数和边界 | 明确标注静态推导、人工确认或运行时追踪 |
| Git | 最近怎样变化、分支怎样分合、某次提交改了哪些文件 | 本机 Git refs、commit parents、log、status、diff |

静态文件依赖图、静态函数调用链、运行时 trace 是不同数据。拓扑序播放不能被标为已经观测到的运行过程。

## 优先评估的候选

### CodeFlow：项目结构浏览的第一候选

- [官方仓库与 README](https://github.com/braedonsaunders/codeflow)
- [MIT 许可](https://github.com/braedonsaunders/codeflow/blob/main/LICENSE)
- [CLI 源码](https://github.com/braedonsaunders/codeflow/blob/main/cli/codeflow.mjs)
- [前端源码](https://github.com/braedonsaunders/codeflow/blob/main/index.html)
- [依赖/入口声明](https://github.com/braedonsaunders/codeflow/blob/main/package.json)

官方描述支持本地文件与 GitHub 仓库分析、可交互依赖图、目录定位、连接文件的代码卡片、依赖影响范围。当前以同一 HTML UI 为核心，CLI 提供本地目录读取和文件监听；浏览器依赖及解析器资源已放在 vendor。

适配判断：可先作为独立现成浏览器工具验证 Jiva，再研究嵌入或抽取视图。它不是现成的 Jiva React 组件包；单 HTML 中功能很多，整体纳入之后的维护成本和性能需要实际测量。

关键核验：能否正确解析 Jiva 的 JSX、相对 import、动态 import；目录聚合后是否易读；是否能从 server.js 找到实际依赖。不能把 import 影响范围当成某次修改必然破坏的功能清单，也不能由文件图直接承诺完整执行路径。

### RepoTrace：架构布局和路径浏览的对照候选

- [官方仓库](https://github.com/somcpp/RepoTrace)
- [许可证入口](https://github.com/somcpp/RepoTrace/blob/main/LICENSE)
- [README 功能与架构](https://github.com/somcpp/RepoTrace#readme)

官方文档描述 React/Vite/React Flow/Dagre 前端、Node/Express/ts-morph 后端；包含 AST 解析、文件/目录搜索、目录聚类、单节点上下游聚焦、符号检查和分步播放器。仓库声明 MIT，但本轮许可证正文抓取失败，需要在取得源码后再核实具体文件。

适配判断：技术栈接近 Jiva，适合比较节点详情、分层布局、目录与画布联动。当前项目规模较小，不能仅凭功能描述称其成熟稳定。

重要边界：README 将拓扑排序的逐步浏览称作 Execution Flow。这更接近静态依赖遍历，不能直接当作用户一次操作的真实运行轨迹。文档不同段落对语言支持也有范围差异，实际支持以解析器代码和样本测试为准。

### GitNexus：更深的静态代码关系，许可与复杂度需要先明确

- [官方仓库](https://github.com/abhigyanpatwari/GitNexus)
- [当前许可证正文](https://github.com/abhigyanpatwari/GitNexus/blob/main/LICENSE)
- [当前 README](https://github.com/abhigyanpatwari/GitNexus#readme)

可以索引符号、依赖、调用关系与执行流程，提供查询、上下文、影响分析和符号间路径追踪，并有 Web 图浏览器。Tree-sitter、图数据库和索引是其主要基础。

它对“从入口追到相关函数”比单纯文件图更有价值，但静态解析仍会受动态调用、跨进程和框架行为影响。当前许可证为 PolyForm Noncommercial 1.0.0，不是可默认用于任意商业集成的 MIT/Apache 许可。本轮不将它列为无条件可移植的底座。

默认 analyze 会写入集成文件与技能等；README 提供 --index-only 以只建索引。本轮没有运行这些命令，也未改 Jiva 的 AGENTS.md、模型或 MCP 配置。

### binaryplease/git-graph：Git 界面的第一组件候选

- [官方仓库](https://github.com/binaryplease/git-graph)
- [嵌入接口说明](https://github.com/binaryplease/git-graph#embedding-the-graph)
- [package.json exports](https://github.com/binaryplease/git-graph/blob/main/package.json)
- [MIT 许可证正文](https://github.com/binaryplease/git-graph/blob/main/LICENSE)

官方提供真实 commit DAG、HEAD/分支/远程 refs、搜索、选中提交的详情、变更文件、diff，以及工作区变更。不是仅有一张 Git 示意图。

最关键的是它明确导出 git-graph/components、git-graph/shared、git-graph/theme.css。组件接收 props，自身不发请求，可以由宿主提供数据。未发布 npm，官方推荐源码 alias 或 git dependency。前端使用 React 19，与 Jiva 一致。

采用判断：优先验证其渲染层，Jiva 自己提供本机 Git 数据。整套服务使用 Bun/Elysia，不能假定其服务端可以不改就交给当前 Node 运行；可先评估组件与已有本机接口的适配。项目仍处于 pre-1.0，需要验证复杂 merge、长历史、窗口截断与空仓库等情况。

官方客户端包含 checkout 操作。这轮项目理解原型可以先使用其展示组件；如要接写操作，需要另行明确行为和恢复方式，不能把完整原版服务无筛选开放给 Jiva 用户。

### React Git Log + Git Diff View：更小的备选组合

- [React Git Log](https://github.com/TomPlum/react-git-log)
- [Apache-2.0 许可](https://github.com/TomPlum/react-git-log/blob/main/LICENSE)
- [当前组件 package.json](https://github.com/TomPlum/react-git-log/blob/main/packages/library/package.json)
- [Git Diff View](https://github.com/MrWangJustToDo/git-diff-view)
- [Git Diff View MIT 许可](https://github.com/MrWangJustToDo/git-diff-view/blob/main/LICENSE)

React Git Log 是 React 19 的历史图组件，提供分支/标签、消息表格、分页和主题。它不是完整 Git 客户端，文件 diff 和 Git 数据获取仍需组合。README 明示 Canvas2D 版本未完成、可能有渲染问题，原型应优先评估 HTML Grid 渲染。

Git Diff View 提供可嵌入的 React diff、Split/Unified 模式与高亮，可与 Git Log 组合。该组合引入的单项能力更清楚，联动工作则由 Jiva 承担。

### Mind Elixir：功能脑图组件候选

- [官方仓库](https://github.com/SSShooter/mind-elixir-core)
- [MIT 许可](https://github.com/SSShooter/mind-elixir-core/blob/master/LICENSE)

框架无关的 JavaScript 脑图核心，支持节点展开、编辑、连接与导出，可以在 React 内挂载。适合承载“项目 → 功能 → 子能力 → 对应文件”的概念树。

它负责画脑图，不负责从代码自动得到正确的功能分组。功能节点与实际文件的映射仍需核对，并能跳到目录、架构图和 Git 文件历史。

## SourceTree 类产品参考与不直接采用的对象

| 项目 | 结论 |
| --- | --- |
| [Gittyup](https://github.com/Murmele/Gittyup) | MIT；C++/Qt/libgit2。分支侧栏、提交图/列表、提交文件和 diff 的联动最适合做布局参照。整体嵌入 React 需另一套原生运行时。[许可证](https://github.com/Murmele/Gittyup/blob/master/LICENSE.md) |
| [Git Graph for VS Code](https://github.com/mhutchie/vscode-git-graph) | 功能相关，但当前 LICENSE 对派生作品发布等有限制，并依赖 VS Code 宿主。可以研究体验，不能默认按 MIT 搬代码。[许可证](https://github.com/mhutchie/vscode-git-graph/blob/develop/LICENSE) |
| [GitButler](https://github.com/gitbutlerapp/gitbutler) | 当前 FSL-1.1-MIT 有适用范围限制；并行/堆叠分支模型比本轮所需复杂，暂不作为直接底座。[许可证](https://github.com/gitbutlerapp/gitbutler/blob/master/LICENSE.md) |
| [GitGraph.js](https://github.com/nicoespeon/gitgraph.js) | MIT，但官方仓库已归档，不优先选为新集成核心。 |
| [arch-diagram](https://github.com/noam812/arch-diagram) | 交互方向贴近架构下钻/流程浏览，但项目较新，不能因 README 描述完整就当成熟基础。 |

## 当前选型倾向与验证顺序

1. 结构浏览先实测 CodeFlow；用 RepoTrace 对照分层布局、符号查看和目录聚合。它们均是候选，不提前承诺性能、准确率或完整复用。
2. Git 先试 git-graph 的 React 展示层；若组件边界或维护成本不合适，再试 React Git Log + Git Diff View。
3. 功能脑图试 Mind Elixir，保持功能概念与真实文件之间的可点击映射。
4. 执行路径先选 Jiva 三条已能人工核对的链：启动、保存文字、创建带资料的 Agent 草稿。明确显示跨 HTTP 与进程边界。自动追踪引擎未实测前不把全仓库路径当作已准确生成。
5. 最后才统一到 Jiva 内页：目录选择定位图节点；节点定位文件；文件定位相关提交；提交选择文件并看 diff。不要先另画一套交互，再回头寻找库填进去。

验证要点：Jiva JSX 与相对/动态 import 的解析、循环依赖和跨 HTTP 边界；目录到图的联动；Git parents/refs 的正确展示；提交文件与 diff 对应；工作区 staged/unstaged/untracked 的区分；规模增大后可读性与性能。

## 本轮已做与未做

已核查上述官方仓库、主要 README、部分源码接口与许可证；同本机 Jiva 的 React/Node 版本对照。没有为此改 Jiva 主程序，也没有发布新的架构/Git demo。

尝试在 demos/research 隔离目录取得 CodeFlow 源码以实测：Git clone 连接未完成后停止；GitHub codeload 在 45 秒限时内下载约 1.3 MB 后超时，无法得到完整归档；raw 源码文件取得也连接超时。所有尝试均已结束。因此本轮没有安装、执行或验证候选工具在 Jiva 上的效果。GitHub 浏览工具能读取的源码内容用于静态核查，不代替运行验证。

推荐是下一轮兼容性验证的顺序，不是已经完成的技术选型，也没有把当前候选一概称为成熟稳定产品。
