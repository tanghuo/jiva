# 账号额度浮动条实施与验收记录

日期：2026-11-01。对应方案：`quota-floating-bar-final.md`。没有提交、推送或创建 PR；保留了实施前的全部工作区修改。

## 后续调整：拖动与样式

多项常驻样式再次调整为紧凑矩形卡片：8px 圆角，拖动/展开控制置顶，平台、额度窗口、剩余百分比分列。`visual-c.css` 原有全局按钮胶囊规则曾覆盖这里的小圆角；现明确排除 `.quota-float`，并以浏览器实际计算圆角和数值列对齐进行回归验证。保留单项胶囊、多项卡片两种形态；浅色/深色截图位于 `.local/quota-implementation/quota-pinned-preview.png`、`quota-card-night.png`（测试数据）。

按用户追加要求，展开面板中的各额度窗口、余额现在可分别勾选常驻。收起后的浮动条按选择顺序同时显示多项，选择保存在本机偏好中；取消全部或点击「恢复自动选择」回到最紧张额度展示。只保存来源与桶 ID，不保存百分比、余额或账号信息；缺失桶显示待更新，旧值保留过期标记。UI 回归覆盖同平台两个窗口、跨平台多选、余额、取消单项、刷新恢复和窄屏。

按用户追加要求，已支持拖动胶囊或面板顶部手柄，松手保存位置；该要求覆盖原方案中首版不支持自由拖动的限制。小于 5px 的位移仍视为点击，拖动不误展开；刷新后恢复位置，缩小窗口时限制在可见范围内，面板按剩余空间向上或向下展开。设置中可重置拖动位置，重新选择左下/右下也会回到自动避让。

胶囊和面板已重做：轻量状态点、拖动手柄、平台标记、细进度条、简短窗口名称和重置时间，统一使用主题颜色。构建和 UI 回归通过，新增实际鼠标拖动、刷新恢复、面板手柄拖动、边缘限制和缩小窗口断言。此轮检查修正了新样式的字重规则，原有七条其他样式违规仍保留。新版测试截图：`.local/quota-implementation/quota-desktop.png`、`quota-mobile.png`（使用测试数据）。

## 使用入口

Grok 认证修正：不能仅凭 auth.json 的 expires_at 判定当前 CLI 登录失效。额度探针现与工作台一致，先 initialize，再以 cached_token/headless 完成 authenticate，最后调用 billing；由官方 CLI 管理自身认证状态，不自行操作 refresh token。已移除先前的缓存过期拦截，补充旧过期元数据下仍可认证读取的协议回归测试，并通过真实账号读取验收。

重启 self-wiki 后，在「设置 → 外观与浏览」开启「显示额度浮动条」，选择左下或右下。默认关闭。「设置 → Agent 连接 → 账号额度来源」可逐家检测，即使浮动条关闭也能手动读取。

Codex、Grok 复用工作台的程序及认证来源配置，但额度读取使用自己拥有的临时连接，不借用或关闭工作台会话。Gemini 使用当前用户已打开的 Antigravity 桌面端，与 ACP 会话的身份分开；不需要另装 agy。

## 真实来源验收

| 来源 | 本机版本 | 已实测的只读路线 | 数据能力及身份 |
| --- | --- | --- | --- |
| Codex / ChatGPT | codex-cli 0.159.0 | app-server `account/rateLimits/read` | 多 limit 结构、300 / 10080 分钟窗口、Unix 秒转换；由 workspaceRouting 与完整读取回显确认账号，以本地盐 HMAC 保存身份 |
| Grok Build | 1.0.70 (f50904eaee6c) | `grok agent stdio` initialize 后 `_x.ai/billing` | 每周 creditUsagePercent、周期、预付余额；金额按参考协议的 cents 保留，余额不冒充百分比。RPC 未回显稳定 principal，身份保守标记 unverified |
| Gemini · Antigravity | 桌面端 2.28.2 | 同用户 language_server 的 loopback HTTPS `RetrieveUserQuotaSummary` | Gemini 和 Claude/GPT 各有 weekly、5h 共享桶；实测 remainingFraction 在桶顶层。没有稳定账号回显，身份标记 unverified |

Antigravity Windows 探针只枚举相关 language_server，核对当前用户和 Antigravity 安装路径，按 PID 筛选监听端口；CSRF 只在 agent 内存中使用。自签名证书例外仅用于该 loopback 请求，不修改全局 TLS。多个候选来源时拒绝猜选。

没有安装或捆绑第三方探针。没有发送模型推理、自动登录、打开登录浏览器、刷新 refresh token、读取浏览器 cookie 或改动 token_usage。

本机没有官方 agy CLI，因此本次实际启用并验收的是 Windows 桌面来源。**agy print 备用采集和其路径编辑没有启用，也没有宣称通过验收**；后端配置预留了独立 CLI 路径字段。Grok 的 HTTP 备用路线同样没有启用，当前实测 RPC 已可完整读取。

未验证身份的每个临时来源会话使用独立随机 key，读取前解除旧会话的当前绑定；其历史不会被拼成稳定账号历史。其身份变化无法可靠观测，因此在新一次读取失败时可能不再展示前一会话旧值，这是主动避免错误归属的保守处理。

## 实施内容

- 独立迁移 47，创建来源状态、当前快照、历史快照三张表；没有复用 token_usage。网络在事务外，单次来源快照短事务写入。每桶保留观测时间，完整响应记录删除事件，部分响应不删除未观测桶。同值刷新只更新新鲜度；历史变化或间隔 30 分钟采样，30 天历史按 500 条分批清理。
- 每来源单飞、最多两个探针并行、2 分钟普通缓存、5 秒手动防连点、2/4/8/16/32/60 分钟失败退避。配置 generation 拒绝迟到结果，停止后的排队探针不会启动。
- Codex 协议层额度通知与轮次结束、Grok prompt 完成只发失效提示；回调异常不会进入原会话失败链。无可见采集订阅者时只标 dirty；有订阅者时去抖完整读取。没有把身份尚未匹配的 Antigravity ACP 轮次当作桌面来源的账号事件。
- 本机管理认证下的 GET /api/quota、POST /api/quota/refresh、GET /api/quota/events；另有 PUT /api/quota/config 管理来源开关。LAN 和 organizer worker 均被拒绝。SSE 使用 epoch、单调 revision、15 秒心跳和最新快照缓冲，关闭服务时先结束订阅与自有探针，再关闭 HTTP 和 DB。
- 根部 useQuota 管理 SSE、15 分钟刷新和 visibility。设置检测订阅不会触发自动事件采集。图片预览、工作流大图、AionUi 通过可清理 token 遮挡；视觉隐藏不会重建根部采集器。浮层按实际资料篮和输入框矩形避让，支持键盘、Esc、外部点击和窄窗口。

## 本次文件清单

新增：

- `src/shared/domain/quota.js`
- `src/agent/executors/{codexQuota,grokQuota,geminiQuota,quotaIdentity,quotaEvents}.js`
- `src/server/data/{quotaMigration,quotaRepository}.js`
- `src/server/application/quotaService.js`
- `src/server/http/quotaRoutes.js`
- `src/renderer/src/{useQuota,quotaPreferences,quotaOcclusion}.js`
- `src/renderer/src/{QuotaFloat,QuotaSettings}.jsx` 与 `quotaFloat.css`
- `test/fixtures/quota/{codex,grok,gemini}.json`：来自本机真实响应的脱敏样本；不是三家账号身份的公开记录。
- `test/unit/quota.test.js`、`test/integration/quota.test.js`、`test/ui/quota-ui.test.js`

仅在以下既有文件接线：

- `codexAppServer.js`、`grokProcess.js`：保留 RPC 错误码、隔离失效通知、额度连接输出限制和关闭。
- `executorsPort.js`：agent 导出边界。
- `wikiMigrations.js`：登记迁移 47；`wiki-core.test.js`：升级版本断言增加 47。
- `server.js`、`http/routes.js`、`http/lanRoutes.js`：装配、权限、关闭。
- `App.jsx`、`SettingsDialog.jsx`：根部采集、外观、来源检测。
- `DetailImage.jsx`、`WorkflowImagePreview.jsx`、`AionuiExperiment.jsx`：遮挡 token。

以上清单是本功能 diff 范围；上述文件中原有的其他工作区修改不属于本次功能。

## 验证与证据

实施前保存的 diff：`.local/quota-implementation/baseline.patch`。该目录还保存构建日志、基线与最终检查日志、三家真实读取的脱敏结果，以及真实服务到界面的截图：

- `quota-live-desktop.png`：真实三家额度的桌面面板。
- `quota-live-mobile.png`、`quota-live-gemini.png`：窄屏布局及 Antigravity 共享桶。
- `live-result.json`：真实三家经过服务调度、仓储与展示选择后的脱敏结果。

上述截图由临时数据库和独立浏览器生成，没有改变正在使用的资料库或默认关闭偏好。

验证结果：

- `npm run build` 通过；新增模块语法检查及 `git diff --check` 通过。
- 额度单元、集成、界面共 11 项测试通过，覆盖真实 fixture、身份 HMAC、观察者错误隔离、单飞/并行/缓存/退避、配置迟到结果、完整/部分快照、清理、账号切换、dirty/通知、权限、SSE 关闭、设置及窄屏。
- 完整低并发测试：`node --test --test-concurrency=2 "test/unit/*.test.js" "test/integration/*.test.js" "test/ui/*.test.js"`，719 项中 714 通过、5 跳过、0 失败。其后完善的边界代码又通过最终 41 项定向回归（含 Codex 外部认证、Grok 超时、Wiki 升级及额度 UI）。
- 原样 `npm run check` 没有全绿：修改前基线有 8 项失败；本次默认高并发运行有界面/浏览器超时，以及本次新增迁移触发的旧版本断言失败。后者已修正，全部测试在并发 2 下通过，没有把新增迁移问题归因给基线。
- 单独运行 `npm run check:arch` 仍有 7 条既有设计规则违规：`workflow.css` 的 30px 控件高度一条、`wiki.css` 的原始 rgb 颜色六条。这两个样式文件不在本功能变更范围；额度文件无新增架构/设计规则违规。

不能把三个真实来源成功读取等同于所有备用路线已经验证。全量日志位于 `.local/quota-implementation/{baseline-check,final-check,limited-concurrency-check,final-targeted-check,architecture}.log`。

协议参考：[Codex app-server](https://learn.chatgpt.com/docs/app-server)、[Grok 探针说明](https://github.com/steipete/CodexBar/blob/main/docs/grok.md)、[Antigravity 探针说明](https://github.com/steipete/CodexBar/blob/main/docs/antigravity.md)。代码为本仓库自行实现，未复制供应商探针代码。
