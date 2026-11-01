import { useRef } from 'react';
import { ArrowUp, Plus } from 'lucide-react';
import WorkbenchModelPicker from './WorkbenchModelPicker.jsx';
import WorkbenchProjectPicker from './WorkbenchProjectPicker.jsx';
import WorkbenchApprovalPicker from './WorkbenchApprovalPicker.jsx';
import useWorkbenchTextarea from './useWorkbenchTextarea.js';
import { maxWorkbenchAttachments, attachmentEvents, attachmentKind } from './workbenchAttachments.js';
import { Button } from '../../ui/Button.jsx';

export default function WorkbenchStart({ settings, change, projects, engines, models, modelState, retryModels, text, setText, busy, create, createProject, selectEngine, loadModels, connectAntigravity, files, addFiles, removeFile }) {
  const { kind, projectId, projectName, engine, model, effort, nativeReadAccepted } = settings;
  const form = useRef(null), fileInput = useRef(null);
  const textarea = useWorkbenchTextarea(text);
  const ready = !busy && text.trim() && model;
  function submit(event) {
    event.preventDefault();
    if (!ready) return;
    create({ trusted: true, nativeReadAccepted: ['codex-cli', 'antigravity-acp'].includes(engine) });
  }
  return <div className="workbench-start">
    <div className="workbench-welcome"><h2>今天想完成什么？</h2></div>
    <form ref={form} className="workbench-launcher" onSubmit={submit} {...attachmentEvents(addFiles)}>
      {!!files.length && <div className="workbench-pending-images">{files.map(image => { const isImage = attachmentKind(image.file) === 'image'; return <button type="button" className={isImage ? 'workbench-image-chip' : 'workbench-file-chip'} key={image.key} aria-label={isImage ? '移除参考图' : `移除附件 ${image.file.name}`} title={image.file.name || '附件'} disabled={busy} onClick={() => removeFile(image.key)}>{isImage ? <img src={image.url} alt="" /> : <span>{image.file.name}</span>}<span className="workbench-image-remove" aria-hidden="true">×</span></button>; })}</div>}
      <textarea ref={textarea} aria-label="任务内容" placeholder="描述任务，也可拖入或粘贴图片、代码、TXT、PDF…" value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (ready) form.current.requestSubmit(); } }} rows={3} disabled={busy} autoFocus />
      <div className="workbench-launcher-toolbar">
        <button type="button" className="icon-only" aria-label="添加附件" title="添加图片、文本、代码或 PDF" disabled={busy || files.length >= maxWorkbenchAttachments} onClick={() => fileInput.current?.click()}><Plus size={19} /></button>
        <input ref={fileInput} aria-label="选择附件文件" hidden type="file" multiple disabled={busy || files.length >= maxWorkbenchAttachments} onChange={event => { const files = [...event.target.files]; event.target.value = ''; if (files.length) addFiles(files); }} />
        <WorkbenchProjectPicker projects={projects} kind={kind} projectId={projectId} projectName={projectName} busy={busy} engine={engine} nativeReadAccepted={nativeReadAccepted} onAcceptNative={value => change({ nativeReadAccepted: value })} onSelect={project => change({ kind: 'project', projectId: project.id, projectPath: project.path, projectName: project.name })} onClear={() => change({ kind: 'scratch', projectId: null, projectPath: '', projectName: '' })} onCreate={createProject} />
        <WorkbenchModelPicker engine={engine} model={model} effort={effort} engines={engines} models={models} modelState={modelState} retryModels={retryModels} busy={busy} change={change} selectEngine={selectEngine} loadModels={loadModels} connectAntigravity={connectAntigravity} />
        <WorkbenchApprovalPicker mode={settings.approvalMode} engine={engine} disabled={busy} onChange={approvalMode => change({ approvalMode })} />
        <Button variant="primary" type="submit" aria-label="发送" title="发送" disabled={!ready} className="icon-only workbench-launch-send"><ArrowUp size={19} /></Button>
      </div>
    </form>
    {engine === 'codex-cli' && <p className="workbench-muted">发送即确认使用 Codex 原生文件访问：可读取工作目录以外的文件。所选审批模式从这一轮生效，网络访问保持关闭。</p>}
    {engine === 'antigravity-acp' && <p className="workbench-muted">发送即确认使用 Antigravity 已有配置、插件和工具；它以当前用户权限访问文件和执行命令，原生请求在此审批，工作目录不构成系统沙箱。</p>}
  </div>;
}
