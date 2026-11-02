import {lazy,Suspense,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,ChevronRight,Code2,FileCode2,Folder,GitBranch,RefreshCw} from 'lucide-react';
import PageHeader from '../../ui/PageHeader.jsx';
import {Segmented} from '../../ui/Tabs.jsx';
import {DialogFrame} from '../../ui/ConfirmDialog.jsx';
import {request} from '../../api.js';
import {JivaMap,JivaMindMap} from './JivaMap.jsx';
import {jivaModules,jivaJourneys} from './jivaGuide.js';
import {projectTree} from './projectModel.js';
import './codeProjects.css';

const ProjectGit=lazy(()=>import('./ProjectGit.jsx'));
function Directory({tree,onFile}) {
  return [...tree.children.values()].sort((a,b)=>Number(a.file)-Number(b.file)||a.name.localeCompare(b.name)).map(node=>node.file?
    <button key={node.path} className="jiva-tree-file" title={node.path} onClick={()=>onFile({file:node.path})}><FileCode2 size={14}/>{node.name}</button>:
    <details key={node.path} open={node.path==='src'||node.path==='src/server'}><summary><Folder size={14}/>{node.name}</summary><div><Directory tree={node} onFile={onFile}/></div></details>);
}
function Source({project,target}) {
  const [content,setContent]=useState(null),[error,setError]=useState('');
  const ref=useRef(null);
  const targetLine=content&&target.anchor?content.split('\n').findIndex(s=>s.includes(target.anchor))+1:0;
  useEffect(()=>{
    let live=true;setContent(null);setError('');
    request(`/api/code-projects/${project.id}/file?${new URLSearchParams({path:target.file})}`).then(v=>{if(live)setContent(v.text);}).catch(e=>{if(live)setError(e.message);});
    return ()=>{live=false;};
  },[project.id,target.file]);
  useEffect(()=>{if(targetLine)ref.current?.querySelector(`[data-line="${targetLine}"]`)?.scrollIntoView({block:'center'});},[content,targetLine]);
  return <div className="jiva-source-panel"><div className="jiva-source-heading"><span>{targetLine?`已定位到第 ${targetLine} 行`:'文件内容'}</span><span>只读源码</span></div>
    {error&&<p role="alert" className="wiki-error">{error}</p>}{content===null&&!error&&<p role="status">正在读取源码…</p>}
    {content!==null&&<pre ref={ref} className="jiva-source">{content.split('\n').map((text,i)=><span key={i} data-line={i+1} className={i+1===targetLine?'is-target':''}><i>{i+1}</i><code>{text||' '}</code></span>)}</pre>}
  </div>;
}
export default function CodeProjects() {
  const [project,setProject]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [selection,setSelection]=useState('ui'),[journeyId,setJourneyId]=useState('overview'),[stepIndex,setStepIndex]=useState(0);
  const [mode,setMode]=useState('map'),[inspector,setInspector]=useState('notes'),[source,setSource]=useState(null),[gitOpen,setGitOpen]=useState(false);
  const activeId=useRef(null),generation=useRef(0);
  async function load() {
    const token=++generation.current;setLoading(true);setError('');
    try {
      const value=await request('/api/code-projects/jiva',{method:'POST',body:'{}'});
      if(token!==generation.current){void request(`/api/code-projects/${value.id}`,{method:'DELETE'}).catch(()=>{});return;}
      const old=activeId.current;activeId.current=value.id;setProject(value);
      if(old)void request(`/api/code-projects/${old}`,{method:'DELETE'}).catch(()=>{});
    }catch(e){if(token===generation.current)setError(e.message);}
    finally{if(token===generation.current)setLoading(false);}
  }
  useEffect(()=>{void load();return()=>{generation.current++;if(activeId.current)void request(`/api/code-projects/${activeId.current}`,{method:'DELETE'}).catch(()=>{});};},[]);
  const journey=jivaJourneys.find(j=>j.id===journeyId),step=journey?.steps[stepIndex];
  const module=jivaModules.find(m=>m.id===selection)||jivaModules[0];
  const tree=useMemo(()=>projectTree((project?.files||[]).filter(f=>f.path.startsWith('src/'))),[project]);
  function selectModule(id){setSelection(id);setInspector('notes');setSource(null);}
  function chooseJourney(id){setJourneyId(id);setStepIndex(0);setSource(null);setInspector('notes');setMode('map');setSelection(jivaJourneys.find(j=>j.id===id)?.steps[0].module||'ui');}
  function chooseStep(index){setStepIndex(index);setSelection(journey.steps[index].module);setSource(null);setInspector('notes');}
  function viewSource(target){setSource(target);setInspector('notes');}
  const showingStep=step&&step.module===selection;
  return <main id="main-content" className="code-project-page jiva-demo">
    <PageHeader title="Jiva" subtitle="代码项目 Demo · 看结构，沿着一次操作读代码" actions={<><button className="text-button" aria-label="刷新 Jiva 源码" disabled={loading} title={loading?'正在读取 Jiva 源码':'重新读取本机 Jiva 源码'} onClick={load}><RefreshCw size={15}/></button><button disabled={!project} title={!project?'源码加载后可查看':'查看 Jiva 的提交和变更'} onClick={()=>setGitOpen(true)}><GitBranch size={15}/>Git 变化</button></>}/>
    {error&&<div className="jiva-load-error" role="alert"><p>{error}</p><button onClick={load}>重新加载 Jiva</button></div>}
    {!project&&loading&&<div className="jiva-loading" role="status"><Code2 size={26}/><p>正在读取 Jiva 的源码…</p></div>}
    {project&&<>
      <nav className="jiva-perspectives" aria-label="Jiva 阅读路线"><button aria-pressed={journeyId==='overview'} onClick={()=>chooseJourney('overview')}>整个项目</button><span aria-hidden="true"/><small>跟一次操作</small>{jivaJourneys.map(j=><button key={j.id} aria-pressed={journeyId===j.id} onClick={()=>chooseJourney(j.id)}>{j.label}<ArrowRight size={13}/></button>)}</nav>
      <div className="jiva-workspace">
        <section className="jiva-map-section"><div className="jiva-map-heading"><div><p className="jiva-eyebrow">{journey?'执行路径':'项目结构'}</p><h2>{journey?.title||'界面、服务和数据，怎样连在一起'}</h2><p>{journey?.description||'Jiva 在本机运行：界面收集操作，服务处理请求，数据留在 SQLite 和本机文件中。'}</p></div><Segmented label="结构显示方式" value={mode} onChange={setMode} items={[{value:'map',label:'架构'},{value:'mind',label:'脑图'}]}/></div>
          {mode==='map'?<JivaMap selected={selection} onSelect={selectModule} journey={journey}/>:<JivaMindMap onSelect={selectModule}/>}
          {journey?<div className="jiva-steps" aria-label="执行步骤">{journey.steps.map((item,i)=><button key={i} aria-current={i===stepIndex?'step':undefined} onClick={()=>chooseStep(i)}><span>{String(i+1).padStart(2,'0')}</span><strong>{item.title}</strong><small>{jivaModules.find(m=>m.id===item.module).title}</small></button>)}</div>:<div className="jiva-map-footer"><span>React + Electron + Node.js + SQLite</span><span>按 Jiva 当前实现整理</span></div>}
        </section>
        <aside className="jiva-inspector" aria-label="模块与源码"><div className="jiva-inspector-toolbar"><button aria-pressed={inspector==='notes'} onClick={()=>{setInspector('notes');setSource(null);}}>当前模块</button><button aria-pressed={inspector==='directory'} onClick={()=>{setInspector('directory');setSource(null);}}><Folder size={13}/>源码目录</button></div>
          {inspector==='directory'?<div className="jiva-directory"><p>Jiva / src</p><Directory tree={tree} onFile={viewSource}/></div>:<div className="jiva-module-notes"><p className="jiva-eyebrow">{showingStep?`步骤 ${stepIndex+1} / ${journey.steps.length}`:module.tag}</p><h2>{showingStep?step.title:module.title}</h2><p>{showingStep?step.description:module.description}</p><code className="jiva-module-path">{module.directory}</code>
            <h3>{showingStep?'这一步的源码':'从这些文件进入'}</h3>{(showingStep?[step]:module.files).map(target=><button className="jiva-source-link" key={target.file+target.anchor} onClick={()=>viewSource(target)}><FileCode2 size={16}/><span><strong>{target.label}</strong><code>{target.file.split('/').at(-1)}</code></span><ChevronRight size={15}/></button>)}
            {showingStep&&<div className="jiva-step-navigation"><button className="text-button button-sm" disabled={stepIndex===0} title={stepIndex===0?'已经是第一步':undefined} onClick={()=>chooseStep(stepIndex-1)}><ArrowLeft size={14}/>上一步</button><button className="text-button button-sm" disabled={stepIndex===journey.steps.length-1} title={stepIndex===journey.steps.length-1?'已经是最后一步':undefined} onClick={()=>chooseStep(stepIndex+1)}>下一步<ArrowRight size={14}/></button></div>}
          </div>}
        </aside>
      </div>
      <p className="jiva-demo-footnote">{journey?'路径依据源码中的请求与调用关系整理，未运行或模拟这些操作。':'地图展示主要职责与边界；详细文件保留在右侧目录。'}{loading?' 正在刷新源码…':''}</p>
      {source&&<DialogFrame title={source.label||source.file.split('/').at(-1)} description={source.file} closeLabel="关闭源码" onClose={()=>setSource(null)} className="jiva-source-dialog" size="wide" bare><Source project={project} target={source}/></DialogFrame>}
      {gitOpen&&<DialogFrame title="Jiva · Git 变化" description="当前仓库的提交、工作区与文件差异" closeLabel="关闭 Git 变化" onClose={()=>setGitOpen(false)} className="jiva-git-dialog" size="wide"><Suspense fallback={<p role="status">正在加载 Git 视图…</p>}><ProjectGit project={project} onFile={file=>{setGitOpen(false);viewSource({file});}}/></Suspense></DialogFrame>}
    </>}
  </main>;
}
