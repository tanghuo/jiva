const BOOK = 'https://github.com/hoochanlon/fq-book';
const TOPICS = [
  {
    id: 'dns', label: 'DNS · 名字与地址', icon: '⌁', title: '网址，到底是怎么找到网站的？', short: '名字背后，还有一次问路。', time: '约 1 分钟',
    teaser: '你记住的是一个名字，电脑需要的是一个地址。打开网页之前，通常会先发生一次悄悄的“问路”。',
    diagram: [['example.com', '你输入的名字'], ['DNS', '查找地址'], ['IP', '用来建立连接']],
    paragraphs: ['想象你要去一家咖啡馆。你记得店名，却不一定记得它的门牌号。域名和 IP 地址之间，也有一点这样的关系。', 'DNS 是一套分布式的命名系统。访问网站时，设备通常需要先查到域名对应的 IP 地址，再尝试与服务器建立连接。这个查询也可能由缓存直接回答。', '但查到地址，只是找到了目的地。连接能不能建立、网站能不能正常响应，是后面的事情。所以，“能查到 IP”和“能打开网页”并不是同一件事。'],
    takeaway: '先找到地址，再尝试连接。DNS 主要解决前一个问题。',
    analogy: '通讯录里有朋友的名字和号码。查到号码，不代表电话一定接得通；电话接通，也不代表对方一定能帮你办事。查找、连接、得到响应，可以分开理解。这个比喻只解释职责，不代表 DNS 就是一台中心通讯录。',
    deep: ['DNS 不只记录 IP 地址，也可以记录邮件服务等信息。一次查询可能经过多个层级，结果通常能缓存一段时间。这里的图只画出了最常见的“名字找地址”。', '换一个 DNS 解析服务，改变的是查询过程；它不会因此修好所有连接、证书或服务器问题。排查时，先区分失败发生在哪一步，比反复更换设置更有方向。'],
    question: '已经查到了正确 IP，但网页还是打不开。这可能吗？', options: ['可能，建立连接和获取页面还可能失败', '不可能，找到地址就一定能打开'], correct: 0,
    feedback: '可以把它理解为“查到了门牌号，仍可能进不去门”。DNS 成功不等于后续连接与网站响应都成功。',
    original: BOOK + '/blob/master/docs/dns%26hosts/dns.md', originalLabel: 'fq-book · DNS',
    reference: 'https://developer.mozilla.org/en-US/docs/Glossary/DNS', referenceLabel: 'MDN · DNS',
    reason: '这个概念能帮助你把“找不到地址”和“连接失败”分开看。它也是继续理解代理和 HTTPS 的一个入口。'
  },
  {
    id: 'proxy', label: 'PROXY · 请求的中转', icon: '⇄', title: '代理，究竟替你做了什么？', short: '一次请求，也可以托人转交。', time: '约 1 分钟',
    teaser: '你发出的请求，不一定直接到达目标网站。中间可能有一个替你转交请求、带回响应的角色。',
    diagram: [['你', '发出请求'], ['代理', '代为转交'], ['网站', '返回响应']],
    paragraphs: ['想象你托一位朋友去窗口取一份资料。你把需求告诉朋友，由他去窗口交涉，再把结果带回来。这是理解代理的一种入门方式。', '正向代理站在客户端这一侧，替客户端访问目标；反向代理站在服务端这一侧，接收访问，再交给后面的服务器处理。它们都可能中转请求，但服务的对象不同。', '使用代理，并不自动意味着所有应用都走同一条路，也不自动意味着通信加密或完全匿名。具体哪些请求经过它，取决于软件与网络设置。'],
    takeaway: '先问“代理替谁办事”，再问“哪些请求会经过它”。',
    analogy: '正向代理像你请的代办人；反向代理像一家公司的前台。你请的人替你对外办事，公司的前台则替公司接待来访者，再把事情分给内部人员。两者都在转交，站的位置不同。',
    deep: ['反向代理常用于把请求分配给多台服务器，也可以承担缓存等工作。它不等于“换一个域名”，而是一种处理客户端与后端通信的安排。', '不要把“经过了中转”和“内容获得了加密保护”混为一谈。代理、连接加密与应用身份识别是不同问题，可以一起存在，也需要分别判断。'],
    question: '一家网站用入口服务把访问分配给多台后端机器，更接近哪一种？', options: ['反向代理，替服务端接待请求', '正向代理，替我的电脑对外办事'], correct: 0,
    feedback: '这里的入口服务在替服务端接待访问，再把请求交给后端。关键是它服务哪一侧，而不是图上箭头朝哪边。',
    original: BOOK + '/blob/master/docs/abc/proxy-s-x.md', originalLabel: 'fq-book · 正向与反向代理',
    reference: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Proxy_servers_and_tunneling', referenceLabel: 'MDN · Proxy servers',
    reason: '把正向与反向代理分清，能帮助你读懂很多网络工具和网站架构的说明。'
  },
  {
    id: 'tls', label: 'HTTPS · 连接的保护', icon: '◇', title: 'HTTPS 保护的，到底是哪一段？', short: '保护连接，不等于为内容背书。', time: '约 1 分钟',
    teaser: '浏览器和网站之间传递的信息，需要防止被途中偷看或篡改。HTTPS 用 TLS 为这段通信提供保护。',
    diagram: [['浏览器', '验证证书'], ['TLS', '保护传输'], ['服务器', '证明身份']],
    paragraphs: ['你把一封信交出去，会在意两件事：途中会不会被偷看，以及收信方是不是你要找的那个人。HTTPS 背后的 TLS，就在解决通信里的这类问题。', '它为传输提供加密与完整性保护，并通常通过服务器证书帮助浏览器验证对方身份。证书验证和 DNS 查找是不同环节：一个侧重身份，一个侧重地址。', '这些保护针对通信连接。一个网站即使使用 HTTPS，也仍可能发布错误信息，或用相似域名冒充其他网站；连接受保护，不等于网站内容必然可信。'],
    takeaway: '地址、身份、传输保护，是三个需要分开理解的问题。',
    analogy: '可以把 DNS 想成查地址，证书验证想成核对收信方的身份证明，传输加密想成把信放入受保护的信封。信封保护内容在路上的传递，却不会判断信里说的事情是真是假。',
    deep: ['TLS 的三个关键作用是加密、完整性保护与身份验证。浏览器会检查服务器证书是否符合它的信任与域名等要求，然后才能建立正常的受保护连接。', 'fq-book 首页把一类证书错误解释为 DNS 发送了错误根证书，这混淆了机制。DNS 查地址，TLS 连接中由服务器提供证书；不能把换 DNS 当作证书错误的通用答案。'],
    question: '一个网页使用了 HTTPS，就能认定它写的内容可信吗？', options: ['能，连接受保护就说明内容可靠', '不能，通信保护和内容真假是两回事'], correct: 1,
    feedback: 'HTTPS 保护的是连接中的通信，并不替网页内容作事实核查。可信的信息仍需要看来源与证据。',
    original: BOOK + '/blob/master/docs/abc/dc_zhenshu.md', originalLabel: 'fq-book · 数字证书',
    reference: 'https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Transport_Layer_Security', referenceLabel: 'MDN · TLS 安全机制',
    reason: '理解保护的范围，可以避免把“连得上、用 HTTPS、内容可信”当成同一件事。'
  }
];
const KEY = 'jiva-curiosity-v1';
let storageAvailable = true;
let state = { saved: [], lastTopic: null, featured: 'dns', branch: null };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved && typeof saved === 'object') {
    state.saved = Array.isArray(saved.saved) ? saved.saved.filter(x => x && typeof x.id === 'string' && TOPICS.some(t => t.id === x.topic) && typeof x.text === 'string' && ['takeaway','question'].includes(x.type)).slice(0, 300) : [];
    state.lastTopic = TOPICS.some(t => t.id === saved.lastTopic) ? saved.lastTopic : null;
    state.featured = TOPICS.some(t => t.id === saved.featured) ? saved.featured : 'dns';
    state.branch = ['analogy', 'deep'].includes(saved.branch) ? saved.branch : null;
  }
} catch { storageAvailable = false; }
const main = document.querySelector('#main');
const reader = document.querySelector('#reader');
let currentTopic = null;
let currentBranch = null;
let toastTimer;
let speechRun = 0;
let speechTimer;
let utterance = null;
let speaking = false;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const topicById = id => TOPICS.find(t => t.id === id) || TOPICS[0];
const link = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); storageAvailable = true; return true; }
  catch { storageAvailable = false; toast('浏览器未能保存；当前页面仍可使用，请导出重要笔记。'); return false; }
}
function toast(message) { const node = document.querySelector('#toast'); node.textContent = message; node.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 4200); }
function pageHead(kicker, title, description) { return `<div class="page-head"><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${description}</p></div>`; }
function diagram(t) { return `<div class="diagram" role="img" aria-label="简化示意：${esc(t.diagram.map(n => n.join('，')).join('；'))}">${t.diagram.map((n,i) => `${i ? '<span class="diagram-line" aria-hidden="true"></span>' : ''}<div class="diagram-node ${i === 1 ? 'accent' : ''}"><b>${n[0]}</b><small>${n[1]}</small></div>`).join('')}</div>`; }
function render() {
  const page = ['explore','saved','sources','research'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'explore';
  document.querySelectorAll('[data-page]').forEach(n => { n.classList.toggle('active', n.dataset.page === page); if(n.dataset.page === page) n.setAttribute('aria-current','page'); else n.removeAttribute('aria-current'); });
  document.querySelector('#saved-count').textContent = state.saved.length;
  document.querySelector('#breadcrumb').textContent = ({explore:'认识互联网',saved:'留下的线索',sources:'这份材料',research:'同类项目调研'})[page];
  main.innerHTML = ({explore:renderExplore,saved:renderSaved,sources:renderSources,research:renderResearch})[page]();
}
function renderExplore() {
  const t = topicById(state.featured);
  const others = TOPICS.filter(x => x.id !== t.id);
  return `${pageHead('FOLLOW YOUR CURIOSITY', '从这里，认识互联网。', '从你收藏的 fq-book 里，挑了几个可以轻松开始的话题。')}
  <div class="explore-grid"><section aria-label="探索入口">
  ${state.lastTopic ? `<div class="resume"><div>上次停在「${topicById(state.lastTopic).label}」<small>位置留着了。想起来，接着看就好。</small></div><button data-action="resume">接着看看 ↗</button></div>` : ''}
  <article class="feature-card"><div class="feature-meta"><span class="tag green">✳ 从一个小问题开始</span><span>${t.time} · 随时可以停</span></div><h2>${t.title}</h2><p class="lead">${t.teaser}</p>${diagram(t)}<div class="feature-actions"><button class="primary" data-action="read" data-topic="${t.id}">给我讲讲 <span aria-hidden="true">↗</span></button><button class="secondary" data-action="listen" data-topic="${t.id}">▷ 听一听</button><button class="quiet" data-action="rotate">换个话题 ⇄</button></div><div class="feature-foot"><span>${t.label} · 整理后的入门讲解</span><button class="inline-link" data-action="source-page">为什么选它？</button></div></article>
  <div class="section-heading"><h2>也许，你还会好奇</h2><span>没有顺序，挑感兴趣的就好</span></div><div class="topic-grid">${others.map(x => `<button class="topic-card" data-action="read" data-topic="${x.id}"><span class="topic-icon" aria-hidden="true">${x.icon}</span><h3>${x.title}</h3><p>${x.short}</p><span class="topic-time">${x.time}</span><span class="topic-arrow" aria-hidden="true">↗</span></button>`).join('')}</div>
  </section><aside class="source-rail"><div class="rail-label">你的收藏，已经有了入口</div><div class="book-cover" aria-label="fq-book 文字封面，demo 自制"><div class="edition">A SMALL WINDOW TO THE INTERNET</div><h3>这本书<br>能让你连接<br>互联网</h3><p>fq-book</p><span class="author">HOOCHANLON / GITHUB</span></div><h2 class="rail-title">hoochanlon / fq-book</h2><p>从网址、代理，到连接背后的原理。<br>一份值得带着问题翻阅的网络资料。</p><a class="source-link" href="${BOOK}" target="_blank" rel="noopener noreferrer">翻翻原始仓库 ↗</a><div class="editor-note"><h3>这次，先替你挑了这些</h3><p><span class="dot"></span>基础概念，适合先建立直觉。</p><p><span class="dot amber"></span>具体工具与配置，使用前另行核验。</p><button class="text-button inline-link" data-action="source-page">看看整理依据 ↗</button></div></aside></div>`;
}
function renderSaved() {
  return `${pageHead('LEAVE A LITTLE TRACE', '留下的，都是你的线索。', '一句有用的话，一个还没想清楚的问题。下次可以从这里继续。')}<div class="toolbar"><span>${state.saved.length} 条线索 · ${storageAvailable ? '保存在当前浏览器' : '当前会话内保存'}</span>${state.saved.length ? '<button class="secondary" data-action="export">导出笔记 ↓</button>' : ''}</div>${!state.saved.length ? '<div class="empty"><div class="empty-symbol">⌁</div><h2>这里可以先空着。</h2><p>遇到想留下的讲解，点一下“留住这句话”。<br>也可以记下自己的问题，不必马上找到答案。</p><a class="primary" href="#explore">随便看看 ↗</a></div>' : state.saved.map(n => `<article class="saved-card"><div class="saved-meta"><span>${n.type === 'question' ? '自己的问题 · 待探索' : '留下的一句话'}</span><span>${esc(topicById(n.topic).label)}</span></div><p>${esc(n.text).replace(/\n/g,'<br>')}</p><div class="saved-actions"><button data-action="read" data-topic="${n.topic}">回到这个话题 ↗</button><button data-action="remove-note" data-id="${esc(n.id)}">移除</button></div></article>`).join('')}`;
}
function renderSources() {
  return `${pageHead('BEHIND THE EXPLANATION', '替你挑，也让你看得见依据。', '原始材料是起点。解释、筛选判断和未核验的部分，分别说明。')}
  <section class="source-section"><h2>这次的材料</h2><p>${link(BOOK, 'hoochanlon / fq-book')} 包含网络原理、具体工具、配置教程和资源推荐。这版只抽取三个概念入口，不能代表已经审计完整本书。</p><div class="source-link-list">${link(BOOK+'/blob/master/docs/_sidebar.md','原始目录')}${link(BOOK+'/blob/master/docs/README.md','作者前言')}</div></section>
  <section class="source-section"><h2>为什么先看这三个？</h2><ul class="source-list">${TOPICS.map(t => `<li><span class="tag green">${t.id.toUpperCase()}</span><div><strong>${t.title}</strong><small>${t.reason}</small><div class="source-link-list">${link(t.original,t.originalLabel)}${link(t.reference,t.referenceLabel)}<button class="inline-link" data-action="read" data-topic="${t.id}">读整理后的讲解 ↗</button></div></div></li>`).join('')}</ul></section>
  <section class="source-section"><h2>原文不一定都对，也不一定都过时</h2><p>一个已发现的机制问题：仓库首页将一类证书错误归因于 DNS 发送错误根证书。DNS 解析与 TLS 证书验证是不同机制；浏览器通常在 TLS 连接中接收服务器证书。换 DNS 不是证书错误的通用解决办法。</p><div class="source-link-list">${link(BOOK+'#neterr_cert_authority_invalid','原文相关段落')}${link('https://developer.mozilla.org/en-US/docs/Glossary/TLS','MDN · TLS 与服务器证书')}</div><div class="callout">因此，demo 的讲解没有直接照抄原文。目录中的工具可用性、推荐服务、具体配置和其他章节仍需逐项核验；这里不把它们一概标为“可用”或“过时”。</div></section>
  <section class="source-section"><h2>内容与原型边界</h2><p>整理日期：2026-11-02。入口选自 fq-book；短文、类比和互动问题为本次独立编写，并参考链接中的 MDN 文档。示意图为了帮助入门，省略了协议细节。</p><p>作者前言写明允许演绎与分享、禁止商用，并说明部分内容来自其他作者。这版仅链接原文，未复制整本书。商业产品若要引入原文，应另行核对各篇内容的授权。</p><p>没有实时模型调用、自动仓库导入或自动事实核查；保存、继续阅读、导出与设备朗读可以实际操作。</p></section>`;
}
function renderResearch() {
  const projects = window.JIVA_RESEARCH || [];
  return `${pageHead('RESEARCH NOTES · 2026.11.02', '有相近的积木，还需要自己的入口。', '按官方仓库与文档调研；未部署这些项目。匹配度是针对本次需求的判断。')}<div class="callout">值得组合的方向：资料整理与引用 → 轻量讲解或听读 → 用户主动选择深入。先验证这段体验，再决定是否引入完整框架。</div><div class="research-grid">${projects.map(p => `<article class="research-card"><div class="research-top"><span class="eyebrow">${esc(p.role)}</span><a class="license" href="${esc(p.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(p.license)}</a></div><h2>${link(p.url,p.name)}</h2><p>${esc(p.description)}</p><dl><dt>值得借鉴</dt><dd>${esc(p.borrow)}</dd><dt>和我们的距离</dt><dd>${esc(p.gap)}</dd><dt>采用成本</dt><dd>${esc(p.cost)}</dd></dl><div class="research-evidence">${link(p.url,'官方仓库')}${link(p.evidence,'功能依据')}</div></article>`).join('')}</div><section class="source-section" style="margin-top:22px"><h2>对 Jiva 的暂定建议</h2><p>先做“内容引用 + 准备好的短讲解 + 可选分支 + 个人线索”的薄层。深入教学与音频生成可以独立接入，避免一开始就把整套课程、日历或任务系统搬进来。</p><p>这次只核查 README、功能文档与许可证；没有做部署、费用、响应时间、生成质量或安全审计。仓库功能描述不等于效果保证，许可证也不自动覆盖第三方服务、模型或数据。</p></section>`;
}
function openReader(id, autoListen = false, resume = false) {
  stopSpeech();
  currentTopic = topicById(id);
  currentBranch = resume ? state.branch : null;
  state.lastTopic = currentTopic.id; state.branch = currentBranch; persist();
  const t = currentTopic;
  document.querySelector('#reader-content').innerHTML = `<header class="reader-header"><div><span>✳</span> 顺着这个好奇 <span> / </span> ${t.id.toUpperCase()}</div><button class="close" data-action="close-reader" aria-label="关闭讲解">×</button></header><div class="reader-grid"><article class="reader-article"><div class="eyebrow">${t.label} · ${t.time}</div><h1 id="reader-title">${t.title}</h1><p class="reader-summary">${t.short}</p><div class="reading-tools"><button class="secondary" id="speech-button" data-action="speech">▷ 听这段讲解</button><button class="secondary" id="save-button" data-action="save-takeaway">${isSaved(t.id) ? '✓ 已留下这句话' : '＋ 留住这句话'}</button></div><div class="audio-status" id="audio-status" role="status"></div><div class="reader-body">${t.paragraphs.map(p => `<p>${p}</p>`).join('')}<div class="takeaway">${t.takeaway}</div></div>${diagram(t)}<div class="branch-label">如果还有一点好奇</div><div class="branch-buttons"><button data-action="branch" data-branch="analogy" aria-pressed="false">换个比喻</button><button data-action="branch" data-branch="deep" aria-pressed="false">再深入一点</button><button data-action="question">留个自己的问题</button></div><div id="branch-content" class="branch-content"></div><form class="note-form" id="note-form" hidden><label for="question-input">现在好奇什么？</label><textarea id="question-input" maxlength="1500" placeholder="例如：为什么有时候换个 DNS 就能打开了？"></textarea><small>这个 demo 会保存问题供你下次继续，目前不会生成 AI 回答。</small><button class="primary" type="submit">先留在这里</button></form><div class="reader-finish"><span>看到这里，也已经很好。</span><button data-action="close-reader">先到这里，下次再说 ↗</button></div></article><aside class="reader-aside"><div class="aside-section"><h3>为什么是这个话题？</h3><p>${t.reason}</p></div><div class="aside-section"><h3>可以回到出处</h3>${link(t.original,t.originalLabel)}${link(t.reference,t.referenceLabel)}<p>入口选自原书；讲解独立编写，参考 MDN 核验。并非原文摘录。</p></div><div class="aside-section"><h3>按你的节奏来</h3><p>先听或读一点。想了解更多，再打开下面的分支。</p><p>阅读位置会留在当前浏览器。</p></div><div class="source-note">预先整理的讲解与分支互动<br>未连接实时 AI</div><button class="next-topic" data-action="read" data-topic="${TOPICS[(TOPICS.indexOf(t)+1)%TOPICS.length].id}"><span><small>另一个方向</small>${TOPICS[(TOPICS.indexOf(t)+1)%TOPICS.length].label}</span><span>↗</span></button></aside></div>`;
  if(!reader.open) reader.showModal();
  reader.scrollTop = 0;
  if(currentBranch) showBranch(currentBranch);
  render();
  if(autoListen) startSpeech();
}
function closeReader() { stopSpeech(); if(reader.open) reader.close(); render(); }
function isSaved(id) { return state.saved.some(n => n.type === 'takeaway' && n.topic === id); }
function saveNote(type, text) {
  if(state.saved.length >= 300) { toast('已达到 demo 的 300 条上限，请先导出并移除一些线索。'); return; }
  const id = globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
  state.saved.unshift({id,type,text,topic:currentTopic.id});
  const saved = persist(); render();
  if(type === 'takeaway') document.querySelector('#save-button').textContent = '✓ 已留下这句话';
  if(saved) toast(type === 'question' ? '问题留下了，下次从这里继续。' : '这句话已放进“留下的线索”。');
}
function showBranch(branch) {
  currentBranch = branch; state.branch = branch; persist();
  document.querySelectorAll('[data-branch]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.branch === branch)));
  const t = currentTopic;
  document.querySelector('#branch-content').innerHTML = branch === 'analogy' ? `<h3>换个日常的角度</h3><p>${t.analogy}</p>` : `<h3>再往里面看一点</h3>${t.deep.map(p => `<p>${p}</p>`).join('')}<details class="check-box"><summary>愿意的话，试着判断一下</summary><p>${t.question}</p>${t.options.map((o,i) => `<button data-action="answer" data-answer="${i}">${o}</button>`).join('')}<div class="check-feedback" id="check-feedback" aria-live="polite"></div></details>`;
}
function stopSpeech() {
  speechRun++; clearTimeout(speechTimer); if('speechSynthesis' in window) window.speechSynthesis.cancel();
  speaking = false; utterance = null;
  const button = document.querySelector('#speech-button'); if(button) button.textContent = '▷ 听这段讲解';
  const status = document.querySelector('#audio-status'); if(status) status.textContent = '';
}
function startSpeech() {
  if(speaking) { stopSpeech(); return; }
  const status = document.querySelector('#audio-status');
  if(!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) { status.textContent = '当前浏览器不支持朗读，文字讲解可以直接阅读。'; return; }
  const run = ++speechRun;
  const voices = window.speechSynthesis.getVoices();
  const zh = voices.find(v => /^zh(-|_)?CN/i.test(v.lang)) || voices.find(v => /^zh/i.test(v.lang));
  if(voices.length && !zh) { status.textContent = '设备暂未提供中文语音，可以先读下面的文字。'; return; }
  utterance = new SpeechSynthesisUtterance([currentTopic.title,...currentTopic.paragraphs,currentTopic.takeaway].join('。'));
  utterance.lang = 'zh-CN'; utterance.rate = .95; if(zh) utterance.voice = zh;
  utterance.onstart = () => { if(run !== speechRun) return; clearTimeout(speechTimer); status.textContent = '正在朗读 · 使用浏览器提供的中文语音'; };
  utterance.onend = () => { if(run !== speechRun) return; stopSpeech(); status.textContent = '这一小段讲完了。想继续，再挑一个方向。'; };
  utterance.onerror = () => { if(run !== speechRun) return; stopSpeech(); status.textContent = '语音未能播放，可以继续阅读同一段文字。'; };
  speaking = true; document.querySelector('#speech-button').textContent = '■ 停止朗读'; status.textContent = '正在请求设备语音…';
  speechTimer = setTimeout(() => { if(run === speechRun) { stopSpeech(); status.textContent = '设备语音暂未启动，可以先读文字，或换浏览器重试。'; } }, 10000);
  window.speechSynthesis.speak(utterance);
}
function exportNotes() {
  const text = '# Jiva · 留下的线索\n\n材料：'+BOOK+'\n\n'+state.saved.map(n => `## ${topicById(n.topic).title}\n\n${n.type === 'question' ? '我的问题（待探索）' : '留下的一句话'}：${n.text}\n\n参考：${topicById(n.topic).reference}`).join('\n\n---\n\n');
  const url = URL.createObjectURL(new Blob([text], {type:'text/markdown;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = 'jiva-留下的线索.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if(!button) return;
  const {action,topic,branch,id,answer} = button.dataset;
  if(action === 'read') openReader(topic);
  else if(action === 'listen') openReader(topic,true);
  else if(action === 'resume') openReader(state.lastTopic,false,true);
  else if(action === 'rotate') { state.featured = TOPICS[(TOPICS.findIndex(t => t.id === state.featured)+1)%TOPICS.length].id; persist(); render(); }
  else if(action === 'source-page') location.hash = 'sources';
  else if(action === 'close-reader') closeReader();
  else if(action === 'about') document.querySelector('#about').showModal();
  else if(action === 'close-about') document.querySelector('#about').close();
  else if(action === 'speech') startSpeech();
  else if(action === 'save-takeaway') { if(isSaved(currentTopic.id)) toast('这句话已经留在你的线索里。'); else saveNote('takeaway',currentTopic.takeaway); }
  else if(action === 'branch') showBranch(branch);
  else if(action === 'question') { document.querySelector('#note-form').hidden = false; document.querySelector('#question-input').focus(); }
  else if(action === 'answer') { document.querySelector('#check-feedback').textContent = (Number(answer) === currentTopic.correct ? '是的。' : '可以再换个角度想。') + currentTopic.feedback; }
  else if(action === 'remove-note') { state.saved = state.saved.filter(n => n.id !== id); persist(); render(); }
  else if(action === 'export') exportNotes();
});
document.addEventListener('submit', event => {
  if(event.target.id !== 'note-form') return;
  event.preventDefault(); const input = document.querySelector('#question-input'); const text = input.value.trim();
  if(!text) { input.focus(); toast('先写一点你想留下的问题。'); return; }
  saveNote('question',text); input.value = ''; document.querySelector('#note-form').hidden = true;
});
reader.addEventListener('cancel',event => {event.preventDefault();closeReader();});
reader.addEventListener('close',stopSpeech);
window.addEventListener('hashchange',() => { if(reader.open) closeReader(); render(); window.scrollTo(0,0); });
window.addEventListener('pagehide',stopSpeech);
render();
