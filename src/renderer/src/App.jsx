import { Activity, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Settings, History } from "lucide-react";
import KeyboardShortcuts from "./KeyboardShortcuts.jsx";
import { isEditableTarget, overlayOpen } from "./shortcuts.js";
import WikiApp from "./WikiApp.jsx";
import AlbumImportStatus from "./AlbumImportStatus.jsx";
import MagnetImportStatus from './MagnetImportStatus.jsx';
import SettingsDialog from "./SettingsDialog.jsx";
import LiquidGlassController from "./LiquidGlassController.jsx";
import WikiSidebar from "./WikiSidebar.jsx";
import AgentSourcePreview from "./AgentSourcePreview.jsx";
import TokenUsagePanel from "./TokenUsagePanel.jsx";
import ReferenceTray from "./ReferenceTray.jsx";
import useReferenceTray from "./useReferenceTray.js";
import { DialogFrame } from "./ui/ConfirmDialog.jsx";
import OrganizationPanel from "./OrganizationPanel.jsx";
import TemporaryShares from "./TemporaryShares.jsx";
import { request } from "./api.js";
import useQuota from './useQuota.js';
import QuotaFloat from './QuotaFloat.jsx';
import PageErrorBoundary from './PageErrorBoundary.jsx';
import { useQuotaPreferences } from './quotaPreferences.js';
import { applySpaceAccent, readStoredSpaceId, writeStoredSpaceId } from './spacePreferences.js';
import { setActiveSpaceId } from './api.js';
import { CreateSpaceDialog } from './SpaceSwitcher.jsx';
import "./wiki.css";
import "./surfaces.css";
import "./shell.css";
import "./visual-c.css";
import "./liquid-glass.css";

const access = document.querySelector('meta[name="wiki-access"]')?.content;
const readOnly = access === "read-only";
// LAN visitors never get the agent, settings or other local-only tools.
const lanGuest = readOnly || access === "lan-edit";
const WorkflowApp = lazy(() => import('./features/workflow/WorkflowApp.jsx'));
const MagnetImports = lazy(() => import('./MagnetImports.jsx'));
const AgentWorkbench = lazy(() => import('./features/agentWorkbench/AgentWorkbench.jsx'));
const AionuiExperiment = lazy(() => import('./features/aionui/AionuiExperiment.jsx'));
// Local launches open the workbench; explicit links and LAN access keep their destinations.
const currentSection = () => {
  if ((window.location.hash || "").startsWith("#shares")) return "shares";
  if (lanGuest) return "wiki";
  if ((window.location.hash || '').startsWith('#imports')) return 'imports';
  if ((window.location.hash || '').startsWith('#aionui')) return 'aionui';
  if ((window.location.hash || '').startsWith('#workflow')) return 'workflow';
  if ((window.location.hash || '').startsWith('#workbench')) return 'workbench';
  const hash = window.location.hash || "";
  if (hash.startsWith("#wiki")) return "wiki";
  if (hash.startsWith("#agent")) return "workbench";
  if (!hash) return "workbench";
  return "wiki";
};

export default function App() {
  const quotaPreferences = useQuotaPreferences();
  const quota = useQuota(!lanGuest && quotaPreferences.enabled);
  const [spaces, setSpaces] = useState([]);
  const [currentSpaceId, setCurrentSpaceId] = useState(() => readStoredSpaceId());
  const [spaceSwitching, setSpaceSwitching] = useState(false);
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [spaceBusy, setSpaceBusy] = useState(false);
  const spaceSwitchTimer = useRef(null);
  const currentSpace = spaces.find((space) => space.id === currentSpaceId) || spaces[0] || null;
  useEffect(() => {
    try {
      for (const key of Object.keys(localStorage)) if (/^wikiChat(?:Draft|Attachments|Activity):/.test(key)) localStorage.removeItem(key);
    } catch { /* Storage may be disabled. */ }
  }, []);
  const [section, setSection] = useState(currentSection);
  const [visited, setVisited] = useState(() => new Set([section]));
  const workspaceScroll = useRef({});
  const wikiCurrentTab = useRef("all");
  const wikiTabChanged = useCallback((key) => { wikiCurrentTab.current = key; }, []);
  const [wikiTabRequest, setWikiTabRequest] = useState(null);
  const [wikiRevision, setWikiRevision] = useState(0), [openRequest, setOpenRequest] = useState(null);
  const refreshWiki = useCallback(() => setWikiRevision((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await request("/api/spaces");
        if (cancelled) return;
        setSpaces(result.spaces || []);
        const stored = readStoredSpaceId();
        const next = result.spaces?.find((space) => space.id === stored) || result.spaces?.[0] || null;
        if (next) {
          setCurrentSpaceId(next.id);
          writeStoredSpaceId(next.id);
          setActiveSpaceId(next.id);
          applySpaceAccent(next.color);
        }
      } catch { /* Space list loads with the shell; content requests fall back to the default space. */ }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!currentSpace) return;
    setActiveSpaceId(currentSpace.id);
    writeStoredSpaceId(currentSpace.id);
    applySpaceAccent(currentSpace.color);
  }, [currentSpace?.id, currentSpace?.color]);
  function selectSpace(space) {
    if (!space || space.id === currentSpaceId) return;
    setSpaceSwitching(true);
    setCurrentSpaceId(space.id);
    writeStoredSpaceId(space.id);
    setActiveSpaceId(space.id);
    applySpaceAccent(space.color);
    refreshWiki();
    clearTimeout(spaceSwitchTimer.current);
    spaceSwitchTimer.current = setTimeout(() => setSpaceSwitching(false), 150);
  }
  async function createSpace(payload) {
    setSpaceBusy(true);
    try {
      const space = await request("/api/spaces", { method: "POST", body: JSON.stringify(payload) });
      setSpaces((current) => [...current, space]);
      setCreateSpaceOpen(false);
      selectSpace(space);
      return space;
    } finally { setSpaceBusy(false); }
  }
  const spaceProps = {
    spaces, currentSpace, spaceSwitching,
    onSelectSpace: selectSpace,
    onCreateSpace: lanGuest ? undefined : () => setCreateSpaceOpen(true),
  };

  const [sourcePreview, setSourcePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState("general");
  const [usageOpen, setUsageOpen] = useState(false);
  const [organizationOpen, setOrganizationOpen] = useState(false), [organizationBusy, setOrganizationBusy] = useState(false);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "auto");
  useEffect(() => {
    // Toolbar "…" menus are <details>; close an open one when the pointer goes elsewhere.
    const close = (event) => { for (const menu of document.querySelectorAll("details.library-menu[open]")) if (!menu.contains(event.target)) menu.open = false; };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Cookies preserve preferences across the desktop backend's changing ports.
    try { document.cookie = `selfWikiTheme=${theme}; Path=/; Max-Age=31536000; SameSite=Strict`; }
    catch { /* Theme switching still works when preferences cannot be saved. */ }
  }, [theme]);
  const [atmosphere, setAtmosphere] = useState(() => {
    try { return document.cookie.split(";").some((entry) => entry.trim() === "selfWikiAtmosphere=soft") ? "soft" : "full"; }
    catch { return "full"; }
  });
  useEffect(() => {
    document.documentElement.dataset.atmosphere = atmosphere;
    try { document.cookie = `selfWikiAtmosphere=${atmosphere}; Path=/; Max-Age=31536000; SameSite=Strict`; }
    catch { /* ignore */ }
  }, [atmosphere]);
  const [liquidGlass, setLiquidGlass] = useState(() => {
    try { return !document.cookie.split(";").some((entry) => entry.trim() === "selfWikiLiquidGlass=off"); }
    catch { return true; }
  });
  useEffect(() => {
    try { document.cookie = `selfWikiLiquidGlass=${liquidGlass ? "on" : "off"}; Path=/; Max-Age=31536000; SameSite=Strict`; }
    catch { /* ignore */ }
  }, [liquidGlass]);
  const [cardTagDisplay, setCardTagDisplay] = useState(() => {
    try { return document.cookie.split(";").some((entry) => entry.trim() === "selfWikiCardTagDisplay=hover") ? "hover" : "always"; }
    catch { return "always"; }
  });
  useEffect(() => {
    document.documentElement.dataset.cardTagDisplay = cardTagDisplay;
    // The desktop backend changes ports on launch; cookies keep this preference across ports.
    try { document.cookie = `selfWikiCardTagDisplay=${cardTagDisplay}; Path=/; Max-Age=31536000; SameSite=Strict`; }
    catch { /* Browsing still works when preferences cannot be saved. */ }
    return () => { delete document.documentElement.dataset.cardTagDisplay; };
  }, [cardTagDisplay]);
  useEffect(() => {
    const change = () => {
      if (uploading) { window.location.hash = section; return; }
      const next = currentSection();
      if (next !== section) workspaceScroll.current[section] = window.scrollY;
      setSection(next); setSourcePreview(null);
      setVisited((current) => current.has(next) ? current : new Set([...current, next]));
      if (next !== "wiki") setOpenRequest(null);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, [uploading, section]);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => window.scrollTo(0, workspaceScroll.current[section] || 0));
    return () => cancelAnimationFrame(frame);
  }, [section]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false), [searchRequest, setSearchRequest] = useState(null);
  const shortcutState = useRef({});
  shortcutState.current = { section, uploading };
  useEffect(() => {
    function keydown(event) {
      if (event.defaultPrevented || event.isComposing || event.altKey) return;
      const { section: current, uploading: busy } = shortcutState.current;
      const typing = isEditableTarget(event.target);
      const searchKey = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "k";
      if (searchKey || (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey)) {
        if (overlayOpen() || busy) return;
        event.preventDefault();
        if (current !== "wiki") window.location.hash = "wiki";
        setSearchRequest({});
        return;
      }
      if (event.key === "?" && !typing && !event.ctrlKey && !event.metaKey && !overlayOpen()) { event.preventDefault(); setShortcutsOpen(true); return; }

    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  const referenceTray = useReferenceTray(!lanGuest, wikiRevision);
  const { references, setReferences, collapsed: referencesCollapsed, setCollapsed: setReferencesCollapsed } = referenceTray;
  const [referenceError, setReferenceError] = useState(""), [referenceBusy, setReferenceBusy] = useState(false);
  const referenceStarting = useRef(false);
  const referenceRequest = useRef(null);
  function addReference(element) {
    if (referenceStarting.current) return;
    if (element.kind === "video") return;
    setReferencesCollapsed(false); setReferenceError(""); referenceRequest.current = null;
    if (references.some((entry) => entry.id === element.id)) return;
    if (references.length >= 12) { setReferenceError("最多加入 12 份资料，请先移除部分内容。"); return; }
    setReferences((current) => current.some((entry) => entry.id === element.id) ? current : [...current, element].slice(0, 12));
  }
  async function startReferenceChat() {
    if (referenceStarting.current || uploading || referenceTray.unresolved || !references.length) return;
    referenceStarting.current = true; setReferenceBusy(true); setReferenceError("");
    const elements = await referenceTray.validate();
    if (!elements?.length) { referenceStarting.current = false; setReferenceBusy(false); return; }
    try {
      const sourceIds = elements.map(element => element.id), signature = JSON.stringify(sourceIds);
      if (referenceRequest.current?.signature !== signature) referenceRequest.current = { signature, key: crypto.randomUUID() };
      const session = await request('/api/agent/wiki-template', { method: 'POST', body: JSON.stringify({ requestKey: referenceRequest.current.key, sourceIds }) });
      const ids = new Set(elements.map(element => element.id));
      setReferences(current => current.filter(element => !ids.has(element.id)));
      referenceRequest.current = null;
      setSourcePreview(null); window.location.hash = 'workbench?session=' + session.id;
    } catch (error) { setReferenceError(error.message); }
    finally { referenceStarting.current = false; setReferenceBusy(false); }
  }
  function selectForAgent(element) { addReference(element); }
  function askAgent() { window.location.hash = 'workbench'; }
  function openSource(id) {
    if (section === 'wiki') setOpenRequest({ id });
    else setSourcePreview(id);
  }
  function browseSource(id, contextId) { setOpenRequest({ id, contextId }); setSourcePreview(null); workspaceScroll.current.wiki = 0; window.location.hash = "wiki"; }
  useEffect(() => {
    const open = (event) => {
      setSettingsSection(event.detail?.section || "general");
      setSettingsOpen(true);
    };
    const close = () => setSettingsOpen(false);
    window.addEventListener("jiva-close-settings", close);
    window.addEventListener("jiva-open-settings", open);
    return () => { window.removeEventListener("jiva-open-settings", open); window.removeEventListener("jiva-close-settings", close); };
  }, []);
  const workspaceNavigation = <>
      <div className="workspace-footer">
        {!lanGuest && <button className="nav-item workspace-settings" onClick={() => { setSettingsSection("general"); setSettingsOpen(true); }}><Settings size={18} />设置</button>}
        <div className="workspace-footer-links">

          {!lanGuest && <details className="workspace-tools-more">
            <summary>用量与整理</summary>
            <div className="workspace-tools-more-body">
              <button className="text-button button-sm" disabled={uploading} onClick={() => setOrganizationOpen(true)}><History size={14} />整理历史</button>
              <button className="text-button button-sm" onClick={() => setUsageOpen(true)}>Token 用量</button>
            </div>
          </details>}
        </div>
        {lanGuest && <span className="workspace-local"><i />{readOnly ? "局域网 · 只读浏览" : "局域网 · 可编辑"}</span>}
      </div>
    </>;
  return <>
    <a className="skip-link" href="#main-content" onClick={(event) => {
      event.preventDefault();
      const main = document.getElementById("main-content");
      if (!main?.offsetParent) { document.querySelector(".workbench-composer textarea")?.focus(); return; }
      // Focusable only while targeted, so clicks inside the page never move focus to <main>.
      main.setAttribute("tabindex", "-1"); main.focus();
      main.addEventListener("blur", () => main.removeAttribute("tabindex"), { once: true });
    }}>跳到主要内容</a>
    <div className="app-layout">
    <div className={`app-workspace ${spaceSwitching ? "is-space-switching" : ""}`} data-space-switching={spaceSwitching || undefined}>
    {visited.has("wiki") && <Activity mode={section === "wiki" ? "visible" : "hidden"}>
      <WikiApp readOnly={readOnly} tabRequest={wikiTabRequest} onTabChange={wikiTabChanged} onBusyChange={setUploading} workspaceNavigation={workspaceNavigation} searchRequest={searchRequest}
        onAddReference={lanGuest ? undefined : addReference} onAskAgent={lanGuest ? undefined : askAgent} externalRevision={wikiRevision} onChanged={refreshWiki} openRequest={openRequest} spaceProps={spaceProps} spaceSwitching={spaceSwitching} />
    </Activity>}
    {section === "shares" && <div className="wiki-shell"><WikiSidebar activeTab="shares" readOnly={lanGuest} onChooseTab={(key) => { setWikiTabRequest({ key }); window.location.hash = "wiki"; }} {...spaceProps}>{workspaceNavigation}</WikiSidebar><TemporaryShares local={!lanGuest} /></div>}
    {section === 'imports' && !lanGuest && <div className="wiki-shell"><WikiSidebar activeTab="imports" onChooseTab={(key) => { setWikiTabRequest({ key }); window.location.hash = 'wiki'; }} {...spaceProps}>{workspaceNavigation}</WikiSidebar><PageErrorBoundary label="磁力导入"><Suspense fallback={<p role="status">正在打开导入任务…</p>}><MagnetImports spaces={spaces} currentSpaceId={currentSpaceId} onOpen={browseSource} onChanged={refreshWiki} /></Suspense></PageErrorBoundary></div>}
    {visited.has('workflow') && !lanGuest && <Activity mode={section === 'workflow' ? 'visible' : 'hidden'}><div className="wiki-shell"><WikiSidebar activeTab="workflow" onChooseTab={(key) => { setWikiTabRequest({ key }); window.location.hash = 'wiki'; }} {...spaceProps}>{workspaceNavigation}</WikiSidebar><PageErrorBoundary label="工作流"><Suspense fallback={<p role="status">正在打开工作流…</p>}><WorkflowApp /></Suspense></PageErrorBoundary></div></Activity>}
    {visited.has('workbench') && !lanGuest && <Activity mode={section === 'workbench' ? 'visible' : 'hidden'}><div className="wiki-shell workbench-shell"><WikiSidebar activeTab="workbench" onChooseTab={(key) => { setWikiTabRequest({ key }); window.location.hash = 'wiki'; }} {...spaceProps}>{workspaceNavigation}</WikiSidebar><PageErrorBoundary label="工作台"><Suspense fallback={<p role="status">正在打开工作台…</p>}><AgentWorkbench onOpen={browseSource} /></Suspense></PageErrorBoundary></div></Activity>}
    {visited.has('aionui') && !lanGuest && <Activity mode={section === 'aionui' ? 'visible' : 'hidden'}><div className="wiki-shell aionui-experiment-shell"><WikiSidebar activeTab="aionui" onChooseTab={(key) => { setWikiTabRequest({ key }); window.location.hash = 'wiki'; }} {...spaceProps}>{workspaceNavigation}</WikiSidebar><PageErrorBoundary label="实验入口"><Suspense fallback={<p role="status">正在打开实验入口…</p>}><AionuiExperiment active={section === 'aionui'} occluded={settingsOpen || shortcutsOpen || usageOpen || organizationOpen || sourcePreview !== null} /></Suspense></PageErrorBoundary></div></Activity>}
    </div>
    </div>
    {!lanGuest && section !== "workbench" && section !== 'aionui' && (references.length > 0 || referenceTray.error) && <ReferenceTray elements={references} collapsed={referencesCollapsed} onCollapse={setReferencesCollapsed} busy={referenceBusy || uploading} loading={referenceTray.loading} error={referenceTray.error || referenceError} onRetry={referenceTray.error ? referenceTray.retry : undefined} startDisabled={referenceTray.loading || referenceTray.unresolved || !references.length}
      onRemove={(id) => { setReferences((current) => current.filter((element) => element.id !== id)); setReferenceError(""); referenceRequest.current = null; }} onClear={() => { setReferences([]); setReferenceError(""); referenceRequest.current = null; }}
      onOpen={openSource} onStart={startReferenceChat} />}
    {sourcePreview !== null && <AgentSourcePreview key={sourcePreview} id={sourcePreview} onClose={() => setSourcePreview(null)} onBrowse={browseSource} onReference={(element) => { selectForAgent(element); setSourcePreview(null); }} onAddReference={(element) => { addReference(element); setSourcePreview(null); }} />}
    <LiquidGlassController enabled={liquidGlass} atmosphere={atmosphere} />
    {!readOnly && <AlbumImportStatus onChanged={refreshWiki} />}
    {!lanGuest && <MagnetImportStatus hidden={section === 'imports' || settingsOpen} onChanged={refreshWiki} />}
    {!lanGuest && quotaPreferences.enabled && <QuotaFloat quota={quota} position={quotaPreferences.position} hidden={section==='aionui' || settingsOpen} />}
    {settingsOpen && !lanGuest && <SettingsDialog key={settingsSection} initialSection={settingsSection} theme={theme} onThemeChange={setTheme} atmosphere={atmosphere} onAtmosphereChange={setAtmosphere} liquidGlass={liquidGlass} onLiquidGlassChange={setLiquidGlass} cardTagDisplay={cardTagDisplay} onCardTagDisplayChange={setCardTagDisplay} onChanged={refreshWiki} onClose={() => setSettingsOpen(false)} />}
    {shortcutsOpen && <KeyboardShortcuts onClose={() => setShortcutsOpen(false)} />}
    {usageOpen && !lanGuest && <TokenUsagePanel onClose={() => setUsageOpen(false)} />}
    {organizationOpen && !lanGuest && <DialogFrame bare label="整理历史" className="wiki-dialog organization-dialog organization-library-dialog" onClose={() => !organizationBusy && setOrganizationOpen(false)} title="整理历史" description="查看 AI 为哪些内容补充了标签和关联。" closeLabel="关闭整理历史" busy={organizationBusy}>
      <OrganizationPanel mode="history" onBusyChange={setOrganizationBusy} onChanged={refreshWiki} onOpen={(id) => { setOrganizationOpen(false); browseSource(id); }} />
    </DialogFrame>}
    {createSpaceOpen && !lanGuest && <CreateSpaceDialog busy={spaceBusy} onClose={() => !spaceBusy && setCreateSpaceOpen(false)} onCreate={createSpace} />}
  </>;
}
