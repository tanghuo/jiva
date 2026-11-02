// A hand-curated reading map for this Jiva demo. Cross-process arrows describe
// verified source contracts; they are not claimed to be runtime observations.
const source = (file, anchor, label) => ({file, anchor, label});
export const jivaModules = [
  {id:'ui', title:'React 界面', tag:'呈现与交互', directory:'src/renderer', description:'资料库、图集、关系画布和 Agent 工作台都在这里。界面收集操作，通过本机 API 读取和保存内容。', x:0,y:0, files:[source('src/renderer/src/App.jsx','export default function App','页面入口'),source('src/renderer/src/WikiApp.jsx','export default function WikiApp','资料库界面'),source('src/renderer/src/features/agentWorkbench/AgentWorkbench.jsx','export default function AgentWorkbench','Agent 工作台')]},
  {id:'http', title:'HTTP 入口', tag:'校验与分发', directory:'src/server/http', description:'接住界面发来的请求，校验本机身份、请求来源与输入，再交给对应的应用服务。HTTP 路由本身不承担数据库存取。', x:270,y:0, files:[source('src/server/http/routes.js','export function createRequestHandler','请求总入口'),source('src/server/http/elementRoutes.js','export async function handleElementRoute','资料库 API'),source('src/server/http/agentWorkbenchRoutes.js','export async function handleAgentWorkbenchRoute','工作台 API')]},
  {id:'service', title:'应用服务', tag:'处理业务动作', directory:'src/server/application', description:'把“添加内容”“运行工作流”“提交一轮对话”这些动作组织起来。它连接领域校验、数据访问和外部能力。', x:540,y:0, files:[source('src/server/application/elementService.js','export function createElementService','内容服务'),source('src/server/application/agentWorkbench/service.js','export async function createAgentWorkbenchService','工作台服务'),source('src/server/server.js','export async function createServer','服务装配')]},
  {id:'desktop', title:'Electron 外壳', tag:'窗口与本机能力', directory:'src/main', description:'桌面入口负责创建窗口、启动本机 Node 服务，并提供剪贴板、文件选择等桌面能力。React 页面运行在窗口内。', x:0,y:220, files:[source('src/main/main.js','async function createMainWindow','桌面窗口'),source('src/main/backendProcess.js','export','后台进程')]},
  {id:'agent', title:'Agent 运行时', tag:'引擎与执行', directory:'src/agent', description:'具体 Agent 引擎在这里连接和运行。工作台服务管理回合与权限，通过引擎接口接收消息和工具事件。', x:270,y:220, files:[source('src/agent/engines/workbench.js','export function openWorkbenchEngine','选择引擎'),source('src/server/application/executorsPort.js','openWorkbenchEngine','应用层入口')]},
  {id:'storage', title:'本地存储', tag:'SQLite 与文件', directory:'src/server/data', description:'SQLite 保存内容、标签、关系和会话等结构化数据；图片、视频等原文件由本机文件存储层管理。', x:540,y:220, files:[source('src/server/data/elementRepository.js','createText(content)','内容存取'),source('src/server/data/sqlite.js','export','数据库'),source('src/server/assets/imageStore.js','export','图片文件存储')]},
];
export const jivaRelations = [
  {source:'desktop',target:'ui',label:'载入页面'},
  {source:'ui',target:'http',label:'本机 API'},
  {source:'http',target:'service',label:'分发动作'},
  {source:'service',target:'storage',label:'读写数据'},
  {source:'service',target:'agent',label:'提交执行'},
];
export const jivaJourneys = [
  {id:'startup',label:'启动应用',title:'打开 Jiva 时，哪些部分先工作？',description:'桌面进程先准备本机服务，再载入 React 页面。浏览器直接访问服务时，会从页面这一段进入。',steps:[
    {module:'desktop',title:'创建桌面窗口',description:'Electron 的 createMainWindow 准备运行目录，并启动或连接本机后台。',...source('src/main/main.js','async function createMainWindow','createMainWindow')},
    {module:'desktop',title:'启动 Node 后台',description:'后台进程启动 server.js，并把就绪地址交回桌面进程。',...source('src/main/backendProcess.js','export','startBackendProcess')},
    {module:'service',title:'装配本机服务',description:'createServer 打开数据库，创建资料库、工作台等服务，再启动 HTTP 监听。',...source('src/server/server.js','export async function createServer','createServer')},
    {module:'ui',title:'载入 React 页面',description:'桌面窗口载入页面；App 负责在资料库、工作台和其他页面之间切换。',...source('src/renderer/src/App.jsx','export default function App','App')},
  ]},
  {id:'text',label:'添加文字',title:'一段文字，怎样进入资料库？',description:'从添加弹窗开始，沿着一条真实请求，看到输入校验、内容服务和最终的数据库写入。',steps:[
    {module:'ui',title:'提交文字',description:'添加弹窗收集正文和标签，向 POST /api/elements 发送内容。',...source('src/renderer/src/AddContentDialog.jsx','async function submit','submit')},
    {module:'http',title:'接住创建请求',description:'路由读取 JSON、确定内容空间，再调用 wiki.create(payload)。',...source('src/server/http/elementRoutes.js','else if (method === "POST") {','handleElementRoute')},
    {module:'service',title:'校验并创建内容',description:'内容服务校验正文等字段，补充创建来源，把写入交给 repo.createText。',...source('src/server/application/elementService.js','create(payload)','create')},
    {module:'storage',title:'写入 SQLite',description:'仓库在事务内插入文字和标签，并返回保存后的内容。界面收到结果后刷新资料库。',...source('src/server/data/elementRepository.js','createText(content)','createText')},
  ]},
  {id:'chat',label:'发送对话',title:'一条对话，怎样交给 Agent？',description:'工作台提交回合；服务负责调度执行，界面通过事件流接收进展。',steps:[
    {module:'ui',title:'从工作台发送',description:'工作台将输入、附件与请求标识提交给当前会话的 turns 接口。',...source('src/renderer/src/features/agentWorkbench/AgentWorkbench.jsx','async function send(event)','send')},
    {module:'http',title:'定位会话与回合',description:'工作台路由把 POST /sessions/:id/turns 交给 service.submit。',...source('src/server/http/agentWorkbenchRoutes.js',"service.submit(Number(match[1])",'提交回合接口')},
    {module:'service',title:'创建并调度回合',description:'工作台服务校验会话和输入、创建回合，并安排 run(job) 执行。',...source('src/server/application/agentWorkbench/service.js','submit(id, value','submit')},
    {module:'agent',title:'连接对应引擎',description:'openWorkbenchEngine 根据会话配置选择 Codex、Grok 或 Antigravity 的引擎实现。',...source('src/agent/engines/workbench.js','export function openWorkbenchEngine','openWorkbenchEngine')},
    {module:'http',title:'把进展推回界面',description:'HTTP 事件流订阅会话变化；工作台接收事件并更新消息与运行状态。',...source('src/server/http/agentWorkbenchRoutes.js',"service.subscribe(send)",'事件流')},
  ]},
];
