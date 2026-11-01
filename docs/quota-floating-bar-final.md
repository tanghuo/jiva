# Jiva 账号额度探针与应用内浮动条：最终实施方案

日期：2026-11-01。范围：Codex、Grok、Gemini 三家均纳入首版。

本文替代《jiva-额度悬浮条-方案.md》。这是实施设计，不代表功能已经实现或真实账号已经验证。文中的供应商接口以官方文档或开源探针为依据；没有实测的部分明确标出，不把参考实现当作官方稳定承诺。

## 1. 目标与边界

在 Jiva 内持续记录三个平台的账号额度，在可选浮动条中展示剩余百分比、额度范围、重置时间与数据新鲜度。桌面版与浏览器模式共用前后端；局域网访客不可访问。

首版必须包含：

- Codex：ChatGPT 登录账号额度。
- Grok：Grok Build 登录账号的额度及可用余额。
- Gemini：用户已确认接入本项目 Antigravity 中使用 Gemini 的额度，界面标注“Gemini · Antigravity”，不能把它伪装成 Gemini 网页订阅额度。
- 当前状态、历史快照、手动刷新、可见页面周期刷新、后端 SSE 推送。
- 设置中的开关与左下／右下位置、收起胶囊与展开面板。

首版不做系统级悬浮窗、托盘、自由拖动、跨设备同步、额度耗尽后自动切换账号或模型、自动购买／兑换／充值、历史曲线。保留历史数据供后续展示。

不安装或捆绑 Win-CodexBar 等第三方探针；参考其实现自行接入。需要官方客户端时提供路径配置与安装／登录指引，不在后台自动安装、更新、登录或打开浏览器。

不修改现有 `token_usage` 的语义与用量面板。账号额度不能由本项目消耗的 token 反推。

## 2. 当前仓库事实与实施基线

本轮检查 HEAD 为 `ad11399`，但工作区存在大量未提交变更，实际文件状态优先于提交号。实施前记录当前 diff，并核对已有变更；不得重置工作区，也不得依据旧文档重复应用三份补丁。

已核对的入口：

| 位置 | 当前事实与用途 |
| --- | --- |
| `src/agent/executors/codexAppServer.js` | 已有 app-server 请求、通知、account/read、外部认证和关闭逻辑；通知回调异常目前可导致连接 fail，额度订阅必须隔离 |
| `src/agent/engines/codexWorkbench.js` | 当前工作台验证版本为 0.159.0；额度通知缺少 threadId，会被工作台轮次过滤逻辑忽略 |
| `src/agent/engines/grokWorkbench.js`、`executors/grokProcess.js` | 已有 Grok ACP 通信，可作为 billing 探针基础 |
| `src/agent/executors/antigravityProcess.js` | 当前使用 agy_acp_server.exe，验证版本 1.4.5；不能假定它就是 agy CLI |
| `src/server/application/executorsPort.js` | application 到 agent 的导出边界 |
| `src/server/data/usageRepository.js` | 本项目 token 统计，不是账号额度 |
| `src/server/http/lanRoutes.js` | 必须新增 quota 路径拒绝规则 |
| `src/renderer/src/App.jsx`、`SettingsDialog.jsx` | 外观设置和全局前端挂载入口 |
| `src/server/server.js` | 服务装配及关闭入口 |

旧文档引用的 codexSession.js、ChatImageViewer.jsx、ChatConversation.jsx、chatRoutes.js 当前不存在，不依赖这些路径。SSE 参考当前工作台实现，视觉遮挡按当前大图／工作流组件核对。

旧效果图位于另一环境的 `/workspace/app-ux/`，本轮未取得；本文的布局约束为可执行依据，不宣称已与效果图逐像素核对。

## 3. Google 来源必须明确

同一 Google 邮箱不代表不同产品共享同一额度池。

| 来源 ID | 展示名称 | 获取路线 | 首版处理 |
| --- | --- | --- | --- |
| `antigravity` | Gemini · Antigravity | 已验证的 Antigravity 本地只读接口或官方 agy usage 命令 | 已确认的必交付来源，先验证实际账号 |
| `gemini-cli` | Gemini CLI | 对仍支持该身份的 Code Assist 账号读取 quota；内部接口需适配与验证 | 不在本次范围，不得拿 Antigravity 数据冒充 |
| `gemini-web` | Gemini 网页／App | 独立网页额度来源，现有参考实现依赖浏览器会话 | 不在本次范围，不增加 cookie 读取 |
| `gemini-api` | Gemini API | API 项目配额／账单，与订阅额度分离 | 本方案不把它等同于订阅剩余百分比 |

Google 官方说明个人、AI Pro、Ultra 的旧 Gemini CLI Google 登录入口已迁移；Standard／Enterprise 有独立迁移安排。不要按旧教程承诺所有个人账号仍能通过 Gemini CLI OAuth 读取额度。[Google 迁移说明](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)

本方案确定按“项目内 Gemini，即 Antigravity 来源”实施；设置和 UI 始终显示来源。若真实返回只有共享平台桶而没有 Gemini 专属桶，显示“Antigravity 共享额度（含 Gemini）”，不虚构模型独立百分比。首版不提供尚未实现的 Gemini CLI／网页来源选择器。

## 4. 供应商接入合同

### 4.1 Codex

- 使用 `account/rateLimits/read`，不发送推理请求。
- 优先解析存在且合法的 `rateLimitsByLimitId`；缺失时使用 `rateLimits`，不重复入库。空映射按该版本实际协议确认，不擅自把旧视图重新填回。
- 保存 `limitId` 与窗口 `primary`／`secondary`，窗口可空；Unix 秒转毫秒。窗口长度来自返回值，不写死 5 小时或每周。
- 保存 limit 层面的 `rateLimitReachedType`，不直接给其所有窗口标成耗尽。只有已验证的映射才标出具体窗口；其余显示“账号／额度组已到上限”。
- `account/rateLimits/updated` 在协议层独立转发为失效提示。首版通过去抖后的完整读取更新，避免猜测通知缺失字段含义。不要因额度订阅者报错而终止原会话。
- API key 登录无此订阅额度时标记 unsupported，不代表余额为零。
- 保留 JSON-RPC 错误码，`-32601` 标记接口不支持，不解析英文报错字符串猜测。

[官方 app-server 协议](https://learn.chatgpt.com/docs/app-server)

### 4.2 Grok Build

- 首选同认证来源的 `grok agent stdio`：initialize 后调用 `_x.ai/billing`。不要向模型发送“查询额度”的提示词。
- 依据实测 fixture 解析当前与必要的旧版响应。CodexBar 文档显示当前可能返回 `config.creditUsagePercent`、周期、产品用量、预付余额，旧版可能为 monthlyLimit／usage.totalUsed。
- 有明确百分比则记录；只有语义匹配的已用和上限、且上限大于零时才计算比例。不能把不同币种、周期、产品的钱包拼成百分比。
- 有余额没有百分比：保留数值、单位与状态 balance_only；有周期没有任何用量：unknown，绝不默认为零。
- RPC 不支持时，可实现有界的 CLI billing HTTP 备选：`https://cli-chat-proxy.grok.com/v1/billing?format=credits`。它是开源探针参考路径，需验证当前认证与响应，不视作公开稳定 API。
- HTTP 备选的短期凭据只能经 agent 层认证适配器读取并直接使用；不返回 application、前端或数据库，不自行续期 refresh token，不读取浏览器 cookie。先确认该凭据与选定 Grok 来源相同，否则不用该备选。
- 个人和团队身份分开；团队不支持时明确显示 unsupported，不能回退到另一个个人账号。

[Grok 实现参考](https://github.com/steipete/CodexBar/blob/main/docs/grok.md)

### 4.3 Gemini · Antigravity

必须先验证实际安装和账号，不假定 ACP 会话拥有 quota 方法。按以下顺序确认可用能力：

1. 检查现有 Antigravity 运行时是否有已确认的只读额度方法。只有协议或真实证据支持时才调用，不猜测 ACP 扩展名。
2. 若不能从 ACP 读取，接入已安装官方 `agy` CLI。候选命令为 `agy -p /usage --output-format json`，CodexBar 已有此路径。须验证目标版本输出确为 usage 报告，不会启动推理、登录网页或交互会话。
3. 官方命令不适配目标版本时，可使用经验证的同用户本地服务只读 quota 接口；CSRF、端口和协议按版本处理，不关闭全局 TLS 校验，不扫描无关进程。

`agy` 与 `agy_acp_server.exe` 的版本和账号需要分别识别。禁止把 ACP 的邮箱直接贴在无法识别账号的 CLI 报告上。无法验证身份时显示“当前本机 Antigravity 登录（身份未验证）”，记录为来源会话级数据，不跨重启或账号切换拼接长期账号历史。

仅保留供应商明确给出的桶与模型映射；百分比为 remainingFraction 时乘 100，并记录原字段语义。不能凭模型名称相似把桶合并。

配置中新增可选官方 CLI 绝对路径与来源说明，不改工作台既有 ACP 路径。如需要用户先安装／登录官方 CLI，设置中显示明确前置条件，不静默安装或跳过该平台。

[Antigravity 实现参考](https://github.com/steipete/CodexBar/blob/main/docs/antigravity.md)、[Gemini 来源区别](https://github.com/steipete/CodexBar/blob/main/docs/gemini.md)

## 5. 身份与连接归属

账号 identity 由 agent 认证边界提供，不由前端或邮箱推断。

- `sourceId`：服务端生成并持久化的随机 ID，标识一项本地连接配置；路径不发给前端。
- `accountKey`：能验证稳定 provider subject／组织身份时，在 agent 层用本地随机盐做 HMAC，输入包含 provider、产品来源、subject、workspace／team；输出不可逆标识。原始身份字段不落额度库。
- 邮箱仅用于掩码展示，不是账号主键；空邮箱不得合并到公共空字符串 key。
- 无稳定身份时，标记 `identityStatus: unverified`，采用本次来源会话随机 key；不得宣称识别出了稳定账号。
- 配置／认证来源变化递增 `generation`，使旧请求和旧通知失效；无可靠账号变更事件时应在读取前后确认身份一致。不能确认的结果降级为未验证身份。
- 当前列表只展示当前配置的来源与已绑定账号；切换账号不把旧账号的快照当成新账号旧值。历史保留但默认不展示离线账号。

连接复用键至少包含 provider、产品来源、sourceId、generation 和可验证身份。只复用完成初始化、仍可读、不会阻塞任务的匹配连接。禁止从全局 Set 随机挑活连接。

额度服务只能关闭自己创建的临时进程；借用连接由原工作台拥有。全部探针超时、取消和结束时清理自身进程树，不按进程名杀进程。Windows 后台子进程隐藏窗口，shell=false，路径和参数分别传入。

## 6. 数据合同：当前状态与历史分开

使用轻量固定适配器集合，不建设通用插件市场。每个适配器提供 describeSource、read 与可选 subscribeInvalidation；read 返回一次完整快照，且明确 completeness。部分结果不能删除旧桶。

统一结果逻辑结构：

```ts
type QuotaResult = {
  provider: 'codex' | 'grok' | 'gemini';
  product: string;
  sourceId: string;
  generation: number;
  accountKey: string;
  identityStatus: 'verified' | 'unverified';
  accountLabel: string;
  completeness: 'full' | 'partial';
  observedAt: number;
  limits: Array<{
    limitId: string;
    label: string;
    reached: boolean | null;
    reachedType: string | null;
  }>;
  buckets: Array<{
    bucketId: string;
    limitId: string;
    windowId: string;
    label: string;
    models: string[];
    usedPercent: number | null;
    remainingPercent: number | null;
    windowMinutes: number | null;
    resetsAt: number | null;
    balance: { value: number; unit: string } | null;
    status: 'ok' | 'balance_only' | 'unknown';
  }>;
};
```

来源状态独立保存：disabled、not_configured、auth_required、unsupported、ok、error。成功读取但缺额度字段为 unknown，不等于请求失败。首次失败也必须有来源行，不能因没有桶而被 UI 隐藏。

标准数值规则：

- null、缺失、NaN、无穷大不转换为零。比例单位由各适配器明确转换；超出已验证语义范围的值标记 unknown／协议错误，不默默 clamp 掩盖单位错误。
- 对合法 0–100 值计算 remainingPercent = 100 - usedPercent。供应商明确允许超额时单独保留超额信息，显示条可截断，但不修改原含义。
- 显示百分比可以四舍五入，颜色与排序使用未舍入值。
- 原始响应不入库，余额展示从验证过的 value 和 unit 生成，不存任意服务端 HTML／错误长文本。

### 6.1 存储

在独立 quotaRepository 内维护以下表，具体 SQL 与当前迁移机制对齐，不复用 token_usage：

| 表 | 主键／职责 |
| --- | --- |
| quota_source_state | sourceId；配置 generation、当前 accountKey、身份状态、来源状态、lastAttemptAt、lastSuccessAt、failureCount、nextAllowedAt、错误码 |
| quota_current | sourceId + accountKey；完整归一化当前 payload、revision、observedAt、每桶最后观测时间 |
| quota_snapshot | UUID；sourceId、accountKey、bucketId、limitId、数值与重置字段、capturedAt、事件类型 |

每次成功读取都更新当前状态、新鲜度和错误状态。历史仅在字段变化或距离上次历史样本达到 30 分钟时追加；变化比较包含百分比、余额、周期、重置时间、状态及限额标记。完整响应删除旧桶时记录 removed 事件，避免后续历史曲线误接。

一次有效完整响应在一个短事务内更新当前值、移除不再存在的桶、写必要历史；网络请求在事务外。部分结果只更新实际观测部分，不刷新未观测桶的时间。

索引覆盖 sourceId/accountKey/bucketId/capturedAt。历史保留 30 天，启动及每天有活动时分批清理。当前状态不因历史清理被删除。失败尝试更新来源状态，不用 error 快照覆盖最后一次成功数值。

### 6.2 新鲜度与展示选择

- `lastSuccessAt` 表示最近成功读取，不使用稀疏历史的 capturedAt 替代。
- 桶 stale 条件：该来源最近采集失败，或该桶超过 30 分钟未观测，或已超过 resetsAt 但尚未重新确认。无法稳定归属身份的数据另标 unverified。
- 重置时间到达不自动恢复 100%，显示“重置时间已到，等待更新”。
- 胶囊先显示当前可信且明确的限额状态，再选择新鲜有效桶中 remainingPercent 最低者；并列按重置时间更晚、最后按稳定 ID 排序。
- 旧的限额状态只能作为“上次已到上限”展示；不得把旧账号或过期桶冒充当前最紧张值。
- 没有新鲜数据时显示“额度待更新”，展开可看旧值；未知／仅余额来源继续显示。部分来源失败时胶囊带“部分未更新”提示。

## 7. 调度、隔离与关闭

前端可见且开关打开时发起刷新，后端不在无人查看时周期轮询。每 15 分钟一次；打开先读缓存再刷新；恢复 visible 后仅在到期时刷新。手动刷新仅针对选定来源或全部来源。

每个 sourceId 独立 in-flight Promise、超时和退避，最多两个探针同时工作；不得由一个 Gemini 慢请求锁住 Codex/Grok。普通刷新成功后 2 分钟内复用缓存；失败退避基准 2 分钟，按 2/4/8/16/32/60 分钟增长。手动刷新可绕过普通缓存，但仍受 5 秒防连点、单飞和供应商 Retry-After 限制。

不在任务发送前额外开进程。已有供应商额度通知、或匹配来源任务完成，可在启用采集时触发刷新：通知去抖 2 秒、最短事件刷新间隔 15 秒，绕过普通 2 分钟缓存但服从失败退避和 Retry-After，确保一次任务后不会一直显示任务前数据。

没有可见订阅者时，通知只标记来源 dirty，不额外请求或启动进程。首版不解析语义未确认的通知为快照。可见订阅者恢复时按 dirty 状态补读。关闭开关阻止新的主动采集；不会影响已有工作台任务。

额度通知监听、解析、存储错误独立捕获，不进入工作台连接 fail 链。额度请求若暴露真实登录失效，可复用认证层状态，但不得因额度功能自行登出、刷新令牌或取消任务。

每个来源请求预算有明确上限：Codex/Grok RPC 默认 10 秒，含进程启动的总预算默认 30 秒；Antigravity usage 总预算最多 90 秒。输出上限 1 MiB；取消服务时取消其自有子进程。

refresh 接口异步接受任务，不等所有供应商完成才更新 UI。各来源完成后独立入库推送。

关闭顺序：停止接受刷新 → 取消自有采集 → 退订供应商事件 → 主动结束 quota SSE 响应和心跳 → 等待短事务结束 → 关闭额度服务 → 原有服务继续关闭 → 最后关闭 DB。注意 SSE 必须在等待 HTTP server.close 完成之前结束，避免退出挂住。

## 8. HTTP 与 SSE

| 接口 | 合同 |
| --- | --- |
| GET /api/quota | 当前来源状态、账号分组、额度桶、tightest、revision；不启动探针 |
| POST /api/quota/refresh | body: { sourceIds?: string[], reason: open/manual/interval/task/notification }；校验来源；202 + 当前快照 + acceptedSources，工作在后台继续 |
| GET /api/quota/events | SSE；首包 snapshot，状态变化后 snapshot，每 15 秒注释心跳 |

服务端不信任客户端 reason 绕过授权；task/notification 可限定为服务内部触发，公开 POST 只接受 open/manual/interval。重复刷新复用现有任务，响应明确 refreshingSources。

统一响应至少含 revision、generatedAt、sources、accounts、tightest、refreshingSources。sources 含 sourceId/provider/product/identityStatus/state/lastAttemptAt/lastSuccessAt/nextAllowedAt/errorCode/safeMessage；桶带 stale、ageMs 和实际观测时间。所有时间毫秒。

SSE 仅发脱敏快照。连接断开退订并清理心跳；慢消费者只保留最新快照，达到缓冲上限断开重连。snapshot 使用服务级单调 revision，重连发送完整当前状态，前端拒绝旧 revision；服务重启用新的 epoch，避免错误丢弃新快照。

quotaRoutes 首先校验路径，再校验 access === local；lanRestriction 同时拒绝 `/api/quota` 及其子路径。沿用现有本机 Cookie／管理认证及写请求检查，不开放新的 CORS 或 LAN 通道。不增加 Electron IPC。

普通来源失败仍可通过 202 接受刷新并经快照呈现；请求格式、权限、来源不存在分别使用适当 4xx，服务关闭时 503，不把所有错误包装为成功。

## 9. 前端与设置

### 9.1 设置

- 外观：显示额度浮动条，默认关闭；左下／右下，默认左下；变更即时生效，沿用现有外观偏好持久化方式。
- Agent 连接：增加额度来源配置区，分别列 Codex、Grok、Gemini 来源、连接状态和“检测额度”。这是首版必要配置，不延后到第二期。
- 检测按钮是明确手动操作，即使浮动条关闭也可执行一次只读检测；普通关闭状态无自动采集。
- Gemini 来源及必要 CLI 路径独立于工作台 ACP 路径。界面写清检测的是哪个产品，不能自动换账号或产品。
- 局域网访客没有上述入口，后端仍独立拒绝。

### 9.2 采集生命周期

根部 useQuota 负责数据、SSE、计时和页面 visibility；QuotaFloat 只负责展示。大图、影院模式、AionUi 的视觉隐藏不卸载采集状态，不造成反复初始化。

页面 hidden 关闭 SSE、停止前端定时；已接受的一次性请求可在预算内结束。关闭开关后清理订阅与计时，不再发新请求。多个窗口的开关只约束各自订阅：其他打开且可见的窗口仍可采集，不承诺某一窗口关闭即可全局停止。

### 9.3 胶囊与展开面板

- 胶囊高约 32px、最大宽 240px，面板目标宽 280px，窄窗口按可用宽度收缩；按钮遵循 28/36/44 规范与主题变量。
- 收起显示例如“Grok · 每周 · 剩 18%”；空间足够再显示重置时间。完整内容可在展开面板和可访问名称中读取。
- 展开按平台 → 账号／来源 → 额度组及窗口显示；每个来源独立显示更新时间、失败原因与刷新动作。
- 每条进度显示剩余；共享额度明确标注，窗口标签包含 limitName 和时长，避免两个同名窗口无法区分。
- 一般中性，剩余 <20% 橙色，<5% 红色；明确限额状态红色。未知和余额不画百分比条。
- 已配置但首次失败显示“额度暂时读不到”；未配置任何来源时隐藏胶囊，在设置中提供配置指引。不得把已配置但未登录误判成完全未配置而隐藏。
- 数据部分成功时仍展示成功平台，并提示其他来源未更新。
- 弹出面板支持键盘 Enter/Space、Esc、点击外部关闭；aria-expanded、刷新状态提示、关闭后焦点返回；Esc 不穿透关闭底层弹窗。

左下避让侧栏，右下避让资料篮；紧凑窗口中面板不得超出视口或盖住主要输入控件。用实际布局尺寸与统一浮层规则适配，不依赖已删除聊天侧栏的 docked 状态。

大图、工作流全屏审阅和 AionUi 原生视图期间隐藏。使用可清理的 token 集合登记遮挡，而不是手工加减裸计数，避免 StrictMode、组件卸载和路由切换造成计数泄漏。

## 10. 文件与分层

| 层 | 建议落点 |
| --- | --- |
| agent | executors/codexQuota.js、grokQuota.js、geminiQuota.js；必要的只读认证身份与连接登记支持 |
| port | application/executorsPort.js 导出采集与失效订阅 |
| shared | domain/quota.js：类型约束、纯归一化公共规则、排序与展示状态；无 node: 依赖 |
| data | quotaRepository.js：当前状态、历史与清理；迁移按现有模式处理 |
| application | quotaService.js：来源配置版本、调度、退避、事件与生命周期 |
| HTTP | quotaRoutes.js、routes.js、lanRoutes.js |
| renderer | useQuota.js、QuotaFloat.jsx、quotaFloat.css、设置连接配置区 |
| 装配 | server.js、App.jsx；明确关闭与遮挡生命周期 |

application 不直接 import agent，HTTP 不直接访问 data，agent 不依赖 server。身份 HMAC 在 Node 侧实现，不塞入 shared。按实际文件规模拆分，不为每个小函数建立额外框架。

## 11. 实施顺序与交付门槛

1. 固定当前工作区基线与目标 Google 来源，核对所需客户端及版本。
2. 三家各做一次不触发推理的只读能力验证，取得脱敏 fixture：认证归属、完整读取结果、通知（若有）、异常响应。没有 fixture 的路径不得标成验证完成。
3. 完成身份隔离、统一数据模型、当前状态和历史仓储，先用 fixture 验证归一化。
4. 接入三家适配器与调度；故障注入确认不会影响现有任务。
5. 接入 HTTP/SSE、权限及关闭；再实现设置、浮动条、遮挡与可见性。
6. 三家真实账号验收、UI 截图和全量检查。

“首版三家接上”的定义：Codex、Grok、选定 Google 来源均完成真实读取链路，并显示供应商真实可提供的数据。仅存在适配器文件、返回 unknown 占位、或只接 Codex 均不算完成。

若 Grok 实际只提供余额，balance_only 是诚实的数据能力，但必须在验收记录中注明“无法取得百分比”，不能宣称已满足百分比展示。Google 来源无法验证身份或客户端能力时同样记录部分完成与具体缺口，不悄悄延期或换成其他产品。用户负责账号登录／必要客户端准备，实现方负责验证和明确报告。

## 12. 测试与验收

### 单元测试

- Codex 多 limit、多窗口、映射缺失／空映射、秒转毫秒、组级限额状态。
- Grok 新旧 fixture、仅余额、只有周期、错误单位、缺失与零、团队不支持。
- Gemini 所选来源真实 fixture、remainingFraction、共享桶、缺身份、来源隔离。
- 未知不为零、百分比单位检查、阈值边界、重置已到、过期与最紧张状态排序。

### 集成测试

- 三家并发刷新分别推进，一个超时不阻塞其他平台。
- 单来源单飞、普通缓存、通知刷新、退避、Retry-After、手动防连点。
- 同值多次成功刷新更新时间但不重复写历史；恢复成功清除旧错误。
- 同邮箱不同工作区、缺邮箱、账号切换、迟到响应和通知 generation 失效。
- 完整响应移除旧桶，部分响应不删除；旧账号不会成为新账号 fallback。
- 额度回调／数据库错误不终止借用任务；只有自有临时进程被清理。
- SSE 首包、断线重连、慢消费者、心跳清理、服务重启 epoch、退出无挂起。
- GET/POST/SSE 的本机认证与 LAN 拒绝；故意注入敏感 fixture 值，确认 DB/API/日志没有泄露。
- 30 天清理、关闭开关无自动进程、当前状态不被历史清理删除。

### UI 与真实环境验收

- 默认关闭、即时生效、两种位置、页面切换、窄窗口、大图／影院／AionUi 隐藏。
- 三个平台、共享桶、余额、未知、首次失败、登录失效、过期、部分失败展示。
- 页面 hidden 停止新周期请求，恢复后按需刷新；视觉隐藏不重建采集器。
- 键盘展开关闭与焦点；布局不遮挡资料篮和输入框。
- 对照三家实际返回逐项核对数值、单位、重置时间和来源账号；明确 Windows 客户端版本与必要配置。
- npm run check 通过。若现有工作区已有失败，记录基线与本次新增失败，不能用“基线失败”掩盖本功能测试未通过。

## 13. 交付物与评审状态

实施交付：仅包含本功能变更的补丁或清晰 diff 清单；不混入当前其他改动，不自动提交、推送或开 PR。附三家脱敏 fixture、测试结果、客户端版本、必要前置配置与 UI 截图。

设计评审结论：APPROVED（限本文内部设计一致性与已检查的仓库入口，采用同上下文自审，未做独立代理审查）。本稿已修正旧稿中的邮箱主键、任意连接复用、历史采样误当新鲜度、通知盲目合并、任务故障传播、过期额度误报、旧路径依赖和首版单平台限制。Google 产品来源已由用户确认为 Antigravity；三家运行时能力、登录身份与实际响应仍须在步骤 1–2 验证。不得将文档评审通过描述为真实接入通过。

## 14. 资料来源

- [Codex app-server 官方协议](https://learn.chatgpt.com/docs/app-server)
- [CodexBar Grok 探针文档](https://github.com/steipete/CodexBar/blob/main/docs/grok.md)
- [CodexBar Antigravity 探针文档](https://github.com/steipete/CodexBar/blob/main/docs/antigravity.md)
- [CodexBar Gemini 探针文档](https://github.com/steipete/CodexBar/blob/main/docs/gemini.md)
- [Google Code Assist 个人账号迁移说明](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)
- [Google Antigravity 更新日志](https://antigravity.google/docs/changelog)

外部项目仅作为证据和实现参考，协议细节随版本变化。直接复用开源代码时保留对应许可证与版权声明。
