import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, FileText, FlaskConical, ImageIcon, Images, Video, Layers, MoreHorizontal, Network, Trash2, Share2, Workflow } from "lucide-react";
import SpaceSwitcher from "./SpaceSwitcher.jsx";

// Content sections shown under 「我的内容」. The trash sits at the bottom of the sidebar.
export const contentSections = [
  { key: "all", label: "全部内容", icon: Layers },
  { key: "image", label: "图片", icon: ImageIcon },
  { key: "album", label: "图集", icon: Images },
  { key: "video", label: "视频", icon: Video },
  { key: "text", label: "文字", icon: FileText },
  { key: "canvas", label: "关系画布", icon: Network },
];
export const wikiSections = [...contentSections, { key: "trash", label: "回收站", icon: Trash2 }];

// Agent 工作台 is the primary Agent entry.
export default function WikiSidebar({
  activeTab, onChooseTab, busy, readOnly = false, children,
  spaces = [], currentSpace = null, spaceSwitching = false, onSelectSpace, onCreateSpace,
}) {
  const local = !['read-only', 'lan-edit'].includes(document.querySelector('meta[name="wiki-access"]')?.content);
  const [utilitiesOpen, setUtilitiesOpen] = useState(false);
  const moreActive = activeTab === "aionui" || activeTab === "shares";
  const [moreOpen, setMoreOpen] = useState(moreActive);
  const nav = useRef(null);
  // On phones the navigation is one scrolling row; keep the current page in view.
  useEffect(() => { nav.current?.querySelector("[aria-current='page']")?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [activeTab]);
  const guard = (event) => { if (busy) event.preventDefault(); };
  const sectionButton = ({ key, label, icon: Icon }) => <button key={key} className={`nav-item ${activeTab === key ? "active" : ""}`} onClick={() => onChooseTab(key)} disabled={busy} aria-current={activeTab === key ? "page" : undefined}><Icon size={18} /><span>{label}</span></button>;
  const shareEntry = <a className={`nav-item wiki-share-entry ${activeTab === "shares" ? "active" : ""}`} href="#shares" aria-current={activeTab === "shares" ? "page" : undefined} onClick={guard}><Share2 size={18} /><span>临时分享</span></a>;
  const contentKeys = new Set(wikiSections.map((section) => section.key));
  const contentFading = spaceSwitching && contentKeys.has(activeTab);
  return <aside className="wiki-sidebar" aria-label="内容导航" data-utilities-open={utilitiesOpen} data-space-switching={spaceSwitching || undefined}>
    <SpaceSwitcher spaces={spaces} current={currentSpace} readOnly={readOnly || !local} busy={busy} switching={spaceSwitching}
      onSelect={onSelectSpace} onCreateRequest={onCreateSpace} />
    {!readOnly && <button className="wiki-utilities-toggle icon-only" aria-label="更多工具" aria-expanded={utilitiesOpen} onClick={() => setUtilitiesOpen((current) => !current)}><MoreHorizontal size={18} /></button>}
    <nav className="wiki-sidebar-nav" ref={nav} aria-label="页面">
      {!readOnly && local && <a className={`nav-item wiki-agent-entry ${activeTab === "workbench" ? "active" : ""}`} href="#workbench" aria-label="Agent 工作台" aria-current={activeTab === "workbench" ? "page" : undefined} aria-disabled={busy} onClick={guard}><Bot size={20} /><span>Agent 工作台</span></a>}
      <div className={`wiki-sidebar-space-content ${contentFading ? "is-fading" : ""}`}>
        <div className="wiki-sidebar-heading">我的内容</div>
        {contentSections.map(sectionButton)}
        <div className="wiki-sidebar-heading">工具</div>
        {!readOnly && local && <a className={`nav-item ${activeTab === 'imports' ? 'active' : ''}`} href="#imports" aria-current={activeTab === 'imports' ? 'page' : undefined} onClick={guard}><Images size={18} /><span>磁力导入图集</span></a>}
        {!readOnly && local && <a className={`nav-item wiki-share-entry ${activeTab === 'workflow' ? 'active' : ''}`} href="#workflow" aria-current={activeTab === 'workflow' ? 'page' : undefined} onClick={guard}><Workflow size={18} /><span>工作流</span></a>}
        {/* Occasional tools sit under 更多 on this machine. LAN guests keep a direct entry. */}
        {!readOnly && local ? <div className="wiki-sidebar-more">
          <button type="button" className={`nav-item wiki-sidebar-more-toggle ${moreActive && !moreOpen ? "active" : ""}`} aria-expanded={moreOpen} aria-controls="wiki-sidebar-more-items" onClick={() => setMoreOpen((current) => !current)}><MoreHorizontal size={18} /><span>更多</span><ChevronDown size={15} className="wiki-sidebar-more-chevron" aria-hidden="true" /></button>
          <div id="wiki-sidebar-more-items" className="wiki-sidebar-more-items" hidden={!moreOpen}>
            {shareEntry}
            <a className={`nav-item ${activeTab === 'aionui' ? 'active' : ''}`} href="#aionui" aria-current={activeTab === 'aionui' ? 'page' : undefined} onClick={guard}><FlaskConical size={18} /><span>AionUi 实验版</span></a>
          </div>
        </div> : shareEntry}
        {!readOnly && <div className="wiki-sidebar-bottom">{sectionButton(wikiSections.at(-1))}</div>}
      </div>
    </nav>
    {children}
  </aside>;
}
