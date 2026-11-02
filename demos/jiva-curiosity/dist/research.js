window.JIVA_RESEARCH = [
  {
    name: 'Open Notebook', role: '替你做准备', license: 'MIT',
    url: 'https://github.com/lfnovo/open-notebook',
    licenseUrl: 'https://github.com/lfnovo/open-notebook/blob/main/LICENSE',
    evidence: 'https://github.com/lfnovo/open-notebook/blob/main/docs/3-USER-GUIDE/transformations.md',
    description: '材料导入后，可以在后台运行 Transformations，把原始来源变成摘要、见解和反思问题。也支持材料问答与播客。',
    borrow: '把转换任务定制成“为什么值得了解、一个生活切口、一段短讲解”，并让产物能回到原始来源。',
    gap: '默认的笔记本、来源和聊天界面，仍可能增加待读材料。未确认有完整的时效核查与个人价值判断流程。',
    cost: '中等。Python / FastAPI + Next.js / React + SurrealDB，需要模型与 embedding；可研究通过 API 接入。'
  },
  {
    name: 'Podcastfy', role: '不想动，也能听一点', license: 'Apache-2.0',
    url: 'https://github.com/souzatharsis/podcastfy',
    licenseUrl: 'https://github.com/souzatharsis/podcastfy/blob/main/LICENSE',
    evidence: 'https://github.com/souzatharsis/podcastfy#readme',
    description: '把 URL、PDF、文本、视频等输入转成对话式音频，允许定制语言、讲述风格与结构。',
    borrow: '独立的“已核验短稿 → 语音”管线，让用户不用组织问题，也能先听懂一点。',
    gap: '它负责讲出来，不负责保证材料可靠、筛掉过时教程，或记住用户是否理解。',
    cost: '低到中等。Python、FFmpeg 与 LLM / TTS 配置。中文听感、费用与生成延迟尚未实测。'
  },
  {
    name: 'DeepTutor', role: '愿意深入，再带着学', license: 'Apache-2.0',
    url: 'https://github.com/HKUDS/DeepTutor',
    licenseUrl: 'https://github.com/HKUDS/DeepTutor/blob/main/LICENSE',
    evidence: 'https://github.com/HKUDS/DeepTutor/blob/main/README.md',
    description: '围绕材料提供阅读、问答、测验、研究与掌握路径，保留连续学习上下文和来源引用。',
    borrow: '原文与解释对照、按概念深入，以及再次打开时接上先前的上下文。',
    gap: '当前还包括任务板、日历和进度等功能。整体照搬，容易让随手收藏变成有负担的学习任务。',
    cost: '较高。Python + Next.js / React，多种解析与检索模块、模型配置；本轮未验证单模块接口。'
  },
  {
    name: 'SurfSense', role: '同份材料，多种入口', license: 'Apache-2.0',
    url: 'https://github.com/MODSetter/SurfSense',
    licenseUrl: 'https://github.com/MODSetter/SurfSense/blob/main/LICENSE',
    evidence: 'https://github.com/MODSetter/SurfSense/blob/main/surfsense_local/README.md',
    description: '当前仓库以本地文档桌面 agent 为重点，提供带引用检索，Studio 可生成摘要、播客等内容。',
    borrow: '保留原文和引用，让同一批来源变成不同的阅读或听读入口；把导入和生成任务分开处理。',
    gap: '偏文档研究与编辑，未形成轻量兴趣陪伴的完整体验；部分官方插件另需服务许可。',
    cost: '较高。Electron / React + Python / FastAPI、SQLite、Docling 等。更适合比较架构，暂不整体移植。'
  }
];
