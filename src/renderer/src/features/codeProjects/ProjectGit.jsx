import { useEffect, useMemo, useRef, useState } from 'react';
import { GitLog } from '@tomplum/react-git-log';
import { DiffView, DiffModeEnum } from '@git-diff-view/react';
import '@git-diff-view/react/styles/diff-view.css';
import { request } from '../../api.js';
import { gitEntries } from './projectModel.js';
import { useProjectTheme } from './useProjectTheme.js';

export default function ProjectGit({project,onFile}) {
  const theme=useProjectTheme();
  const git=project.git, entries=useMemo(()=>git.available?gitEntries(git):[],[git]);
  const [selected,setSelected]=useState(null),[detail,setDetail]=useState(null),[patch,setPatch]=useState(null),[path,setPath]=useState(''),[error,setError]=useState(''),[query,setQuery]=useState(''),[area,setArea]=useState('history');
  const requestSeq=useRef(0),commitSeq=useRef(0);
  useEffect(()=>()=>{requestSeq.current++;commitSeq.current++;},[]);
  async function choose(commit) {
    const token=++commitSeq.current; requestSeq.current++;setSelected(commit);setDetail(null);setPatch(null);setPath('');setError('');
    if(!commit)return;
    try{const result=await request(`/api/code-projects/${project.id}/commit?hash=${commit.hash}`);if(token===commitSeq.current)setDetail(result);}catch(e){if(token===commitSeq.current)setError(e.message);}
  }
  async function diff(file) {
    const token=++requestSeq.current;setPath(file);setPatch(null);setError('');
    const params=new URLSearchParams({path:file,...(area==='history'?{hash:selected.hash}:{area})});
    try{const result=await request(`/api/code-projects/${project.id}/diff?${params}`);if(token===requestSeq.current)setPatch(result.diff);}catch(e){if(token===requestSeq.current)setError(e.message);}
  }
  function changeArea(value){requestSeq.current++;commitSeq.current++;setArea(value);setSelected(null);setDetail(null);setPatch(null);setPath('');setError('');}
  if(!git.available)return <div className="ui-empty"><h2>Git 历史暂不可用</h2><p>{git.reason}</p><p>目录、结构图和静态路径仍可浏览。</p></div>;
  const files=area==='history'?detail?.files||[]:git.changes.filter(f=>area==='staged'?f.staged:area==='unstaged'?f.unstaged:f.untracked).map(f=>f.path);
  return <section className="code-project-git" aria-label="项目 Git 浏览器"><div className="code-project-git-toolbar"><select aria-label="Git 视图" value={area} onChange={e=>changeArea(e.target.value)}><option value="history">提交历史</option><option value="staged">暂存区 · {git.changes.filter(f=>f.staged).length}</option><option value="unstaged">工作区 · {git.changes.filter(f=>f.unstaged).length}</option><option value="untracked">未跟踪 · {git.changes.filter(f=>f.untracked).length}</option></select><input aria-label="搜索提交" placeholder="搜索说明、作者或 hash" value={query} onChange={e=>setQuery(e.target.value)}/><span>{git.branch||'游离 HEAD'} · 最多 {git.historyLimit} 条 · 只读快照</span></div>
    {area==='history'&&<><div className="code-project-refs">{git.refs.map(ref=><span key={ref.name} title={ref.hash}>{ref.name}</span>)}</div>{entries.length?<div className="code-project-history"><GitLog theme={theme} colours="neon-aurora-light" entries={entries} currentBranch={git.branch||'HEAD'} showGitIndex={false} defaultGraphWidth={150} rowSpacing={4} onSelectCommit={choose} filter={commits=>commits.filter(c=>!query||`${c.message} ${c.author?.name||''} ${c.hash}`.toLowerCase().includes(query.toLowerCase()))}><GitLog.GraphHTMLGrid nodeSize={12}/><GitLog.Table row={({commit})=><div className="code-project-commit-row" role="button" tabIndex={0} aria-label={`提交 ${commit.hash.slice(0,8)} ${commit.message}`} onKeyDown={e=>{if(e.key==='Enter')void choose(commit);}}><code>{commit.hash.slice(0,8)}</code><span>{commit.message}</span><small>{git.commits.find(c=>c.hash===commit.hash)?.refs.join(' · ')}</small></div>}/></GitLog></div>:<p className="wiki-muted">此仓库还没有提交。</p>}</>}
    {error&&<p role="alert" className="wiki-error">{error}</p>}
    {(selected||area!=='history')&&<div className="code-project-git-detail"><aside><h3>{area==='history'?'本次提交的文件':'变更文件'}</h3>{detail&&<p>{detail.message}</p>}{selected&&!detail&&!error&&<p role="status">正在读取提交…</p>}{!files.length&&<p className="wiki-muted">没有可显示的文件。</p>}{files.map(file=><button key={file} className={path===file?'is-selected':''} onClick={()=>{if(area==='untracked'){setPath(file);onFile(file);}else void diff(file);}}>{file}</button>)}</aside><div className="code-project-diff"><div className="code-project-file-heading"><strong>{path||'选择文件查看差异'}</strong>{path&&<button className="text-button button-sm" onClick={()=>onFile(path)}>在目录中定位</button>}</div>{patch!==null&&(patch.includes('@@')?<DiffView key={`${area}:${selected?.hash}:${path}`} data={{oldFile:{fileName:path},newFile:{fileName:path},hunks:[patch]}} diffViewMode={DiffModeEnum.Unified} diffViewTheme={theme} diffViewHighlight={false}/>:<p className="wiki-muted">{patch||'这份文件在所选比较中没有文本差异。'}</p>)}</div></div>}
  </section>;
}
