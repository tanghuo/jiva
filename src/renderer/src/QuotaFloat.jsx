import { useEffect,useRef,useState } from 'react';
import { quotaProviders,quotaPresentation } from '../../shared/domain/quota.js';
import { useQuotaOccluded } from './quotaOcclusion.js';
import { GripVertical, ChevronDown, X, RefreshCw, Gauge } from 'lucide-react';
import { useQuotaPreferences, setQuotaPreferences } from './quotaPreferences.js';
import './quotaFloat.css';
export const quotaProviderLabel = provider => quotaProviders.find(p=>p.provider===provider)?.label || provider;
const compactLabel = label => label
  .replace(/\bcodex\b/gi,'Codex')
  .replace('Gemini Models','Gemini').replace('Claude and GPT models','Claude / GPT')
  .replace(/Weekly Limit Remaining|10080\s*分钟|每周(?:积分|额度|限额)?|周限额/gi,'每周额度')
  .replace(/Five Hour Limit Remaining|300\s*分钟|五小时(?:额度|限额)?|5\s*小时(?:额度|限额)?/gi,'5 小时额度');
const bucketValue = bucket => !bucket?'待更新':bucket.remainingPercent!==null?`剩 ${Math.round(bucket.remainingPercent)}%`:bucket.balance?`${bucket.balance.value} ${bucket.balance.unit==='cents'?'美分':bucket.balance.unit}`:'用量未知';
const hasPin = (pins,sourceId,bucketId) => pins.some(p=>p[0]===sourceId&&p[1]===bucketId);
export function QuotaSource({source,account,refreshing,onRefresh,actionLabel='刷新',pins,onPinChange}) {
  return <section className="quota-source" aria-busy={refreshing}><header><strong><span className="quota-provider-mark" data-provider={source.provider}>{source.provider==='codex'?'C':source.provider==='grok'?'G':'✦'}</span>{source.label}</strong><button type="button" disabled={refreshing} onClick={()=>onRefresh([source.sourceId])}>{refreshing?'读取中…':actionLabel}</button></header>
    <small>{account?.accountLabel || '当前本机登录'}{source.identityStatus==='unverified'&&!account?.accountLabel?.includes('身份未验证')?' · 身份未验证':''}</small>
    {source.safeMessage&&<p role="status">{source.safeMessage}</p>}
    {!account&&!source.safeMessage&&<p>{source.state==='disabled'?'已停用采集':source.state==='not_configured'?'尚未检测额度':'额度暂时读不到'}</p>}
    {account?.limits.filter(l=>l.reached).map(l=><p className="quota-danger" key={l.limitId}>{l.label} · {source.state==='ok'&&Date.now()-account.observedAt<=1800000&&!account.buckets.some(b=>b.limitId===l.limitId&&b.stale)?'账号／额度组已到上限':'上次已到上限'}</p>)}
    {account?.buckets.map(bucket=><div key={bucket.bucketId} className={`quota-bucket ${bucket.stale?'is-stale':''}`} data-level={bucket.remainingPercent!==null&&bucket.remainingPercent<5?'danger':bucket.remainingPercent!==null&&bucket.remainingPercent<20?'warning':'normal'}>
      <div><span title={compactLabel(bucket.label)}>{onPinChange?<label className="quota-pin-choice"><input type="checkbox" checked={hasPin(pins,source.sourceId,bucket.bucketId)} aria-label={`${source.label} · ${compactLabel(bucket.label)} 常驻浮动条`} onChange={event=>onPinChange(source.sourceId,bucket.bucketId,event.target.checked)}/>{compactLabel(bucket.label)}</label>:compactLabel(bucket.label)}</span><strong className={bucket.remainingPercent!==null&&bucket.remainingPercent<5?'quota-danger':bucket.remainingPercent!==null&&bucket.remainingPercent<20?'quota-warning':''}>{bucketValue(bucket)}</strong></div>
      {bucket.remainingPercent!==null&&<progress max="100" value={bucket.remainingPercent} aria-label={`${compactLabel(bucket.label)} 剩余百分比`} />}
      {bucket.resetsAt&&<small>{bucket.resetsAt<=Date.now()?'重置时间已到，等待更新':`${new Date(bucket.resetsAt).toLocaleString(undefined,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} 重置`}</small>}
      {bucket.stale&&<small>上次数据 · 待更新</small>}
    </div>)}
    <small>{source.lastSuccessAt?`更新于 ${new Date(source.lastSuccessAt).toLocaleTimeString()}`:'尚无成功读取'}{source.nextAllowedAt>Date.now()?` · 自动重试 ${new Date(source.nextAllowedAt).toLocaleTimeString()}`:''}</small>
  </section>;
}
export default function QuotaFloat({quota,position='left',hidden=false}) {
  const occluded=useQuotaOccluded(),[open,setOpen]=useState(false),[,tick]=useState(0),[bottom,setBottom]=useState(null),root=useRef(null),trigger=useRef(null);
  const preferences=useQuotaPreferences(),[dragPoint,setDragPoint]=useState(null),[dragging,setDragging]=useState(false),[viewport,setViewport]=useState(()=>({width:window.innerWidth,height:window.innerHeight}));
  const [anchorSize,setAnchorSize]=useState({width:240,height:36});
  const drag=useRef(null),suppressClick=useRef(false);
  const clampPoint=point=>({x:Math.max(12,Math.min(point.x,window.innerWidth-(trigger.current?.offsetWidth||240)-12)),y:Math.max(12,Math.min(point.y,window.innerHeight-(trigger.current?.offsetHeight||36)-12))});
  const point=dragPoint||preferences.point&&clampPoint(preferences.point);
  function startDrag(event){
    if(event.button!==0||!trigger.current)return;
    const rect=trigger.current.getBoundingClientRect();
    drag.current={id:event.pointerId,startX:event.clientX,startY:event.clientY,x:rect.x,y:rect.y,moved:false};
    suppressClick.current=false;event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event){
    const current=drag.current;if(!current||current.id!==event.pointerId)return;
    const dx=event.clientX-current.startX,dy=event.clientY-current.startY;
    if(!current.moved&&Math.hypot(dx,dy)<5)return;
    current.moved=true;suppressClick.current=true;setDragging(true);
    const next=clampPoint({x:current.x+dx,y:current.y+dy});current.point=next;setDragPoint(next);
  }
  function finishDrag(event){
    const current=drag.current;if(!current||current.id!==event.pointerId)return;
    drag.current=null;setDragging(false);
    if(current.moved&&event.type!=='pointercancel')setQuotaPreferences({point:current.point});
    setDragPoint(null);
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const dragHandlers={onPointerDown:startDrag,onPointerMove:moveDrag,onPointerUp:finishDrag,onPointerCancel:finishDrag,onLostPointerCapture:finishDrag};
  useEffect(()=>{const resize=()=>setViewport({width:window.innerWidth,height:window.innerHeight});window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  const close=()=>{setOpen(false);trigger.current?.focus({preventScroll:true});};
  useEffect(()=>{const timer=setInterval(()=>tick(n=>n+1),30000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(!trigger.current)return;
    const observer=new ResizeObserver(()=>{const {width,height}=trigger.current.getBoundingClientRect();setAnchorSize(old=>old.width===width&&old.height===height?old:{width,height});});
    observer.observe(trigger.current);return()=>observer.disconnect();
  },[hidden,occluded,Boolean(quota.snapshot)]);
  useEffect(()=>{
    if(hidden||occluded||!quota.snapshot||preferences.point||dragging)return;
    let frame;
    const measure=()=>{
      cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
        if(!root.current)return;
        const rect=root.current.getBoundingClientRect();
        let offset=window.innerWidth<=720?72:position==='right'?64:12;
        for(const node of document.querySelectorAll('.reference-tray,.workbench-composer,.workbench-launcher')){
          const obstacle=node.getBoundingClientRect();
          if(obstacle.width&&obstacle.height&&obstacle.top<window.innerHeight&&obstacle.left<rect.right&&obstacle.right>rect.left)offset=Math.max(offset,window.innerHeight-obstacle.top+12);
        }
        setBottom(offset);
      });
    };
    const observer=new ResizeObserver(measure);observer.observe(document.body);
    for(const node of document.querySelectorAll('.reference-tray,.workbench-composer,.workbench-launcher'))observer.observe(node);
    const mutation=new MutationObserver(measure);mutation.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);measure();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();mutation.disconnect();window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true);};
  },[hidden,occluded,position,Boolean(quota.snapshot),open,preferences.point,dragging,anchorSize.width,anchorSize.height]);
  useEffect(()=>{
    if(!open)return;
    const pointer=e=>{if(root.current&&!root.current.contains(e.target))setOpen(false);};
    const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}};
    document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key,true);};
  },[open]);
  useEffect(()=>{if(hidden||occluded)setOpen(false);},[hidden,occluded]);
  if(hidden||occluded||!quota.snapshot)return null;
  const {sources,refreshingSources}=quota.snapshot;
  if(!sources.some(s=>s.configured))return null;
  const {accounts,tightest}=quotaPresentation(sources,quota.snapshot.accounts);
  const pins=preferences.pins;
  const pinned=pins.map(([sourceId,bucketId])=>{const source=sources.find(s=>s.sourceId===sourceId),bucket=accounts.find(a=>a.sourceId===sourceId)?.buckets.find(b=>b.bucketId===bucketId);return {sourceId,bucketId,source,bucket};});
  const pinChange=(sourceId,bucketId,checked)=>setQuotaPreferences({pins:checked?[...pins,[sourceId,bucketId]]:pins.filter(p=>p[0]!==sourceId||p[1]!==bucketId)});
  const pinLabel=item=>item.source?.provider==='gemini'&&item.bucket?compactLabel(item.bucket.label):`${item.source?.provider==='grok'?'Grok':item.source?.provider==='codex'?'Codex':item.source?.provider==='gemini'?'Antigravity':'额度项'} · ${item.bucket?compactLabel(item.bucket.label).replace(/^codex · |^Grok · /i,''):'待更新'}`;
  const pinPlatform=item=>item.source?.provider==='codex'?'Codex':item.source?.provider==='grok'?'Grok':item.source?.provider==='gemini'?compactLabel(item.bucket?.label||'').includes('Claude / GPT')?'Claude/GPT':'Gemini':'额度项';
  const pinWindow=item=>compactLabel(item.bucket?.label||'待更新').match(/每周额度|5 小时额度/)?.[0]||compactLabel(item.bucket?.label||'待更新').replace(/^codex · |^Grok · /i,'');
  const pinWindowShort=item=>{const window=pinWindow(item);if(window==='每周额度')return '周';if(window==='5 小时额度')return '5h';if(item.source?.provider==='gemini'||!item.bucket||window==='待更新')return '';return window.replace(/额度$/,'').trim();};
  const resetHint=bucket=>{if(!bucket?.resetsAt)return '';const ms=bucket.resetsAt-Date.now();if(ms<=0)return ' · 重置时间已到';const h=Math.floor(ms/3600000),m=Math.max(1,Math.round(ms%3600000/60000));return ` · ${h>=24?`${Math.floor(h/24)} 天 ${h%24} 小时`:h?`${h} 小时 ${m} 分`:`${m} 分钟`}后重置`;};
  const pinShortLabel=item=>{const platform=pinPlatform(item),window=pinWindow(item);if(window==='每周额度')return `${platform}周`;if(window==='5 小时额度')return `${platform} 5h`;if(item.source?.provider==='gemini'||!item.bucket||window==='待更新')return platform;return `${platform} ${window.replace(/额度$/,'')}`.trim();};
  const windowLabel=tightest?.windowMinutes===10080?'每周额度':tightest?.windowMinutes===300?'5 小时额度':tightest?.windowMinutes?`${Math.round(tightest.windowMinutes)} 分钟额度`:compactLabel(tightest?.label||'').match(/每周额度|5 小时额度/)?.[0]||'额度';
  const shortProvider=tightest?.provider==='gemini'?'Gemini':tightest?.provider==='grok'?'Grok':'Codex';
  const text=tightest?`${shortProvider} · ${tightest.reached?'额度组已到上限':`${windowLabel} · 剩 ${Math.round(tightest.remainingPercent)}%`}`:'额度待更新';
  const partial=sources.some(s=>s.enabled&&s.state!=='ok');
  const panelWidth=Math.min(320,viewport.width-24),panelDown=point&&viewport.height-point.y-anchorSize.height>point.y;
  const panelLeft=point?Math.min(0,viewport.width-12-point.x-panelWidth):position==='right'?undefined:0;
  const panelHeight=point?(panelDown?viewport.height-point.y-anchorSize.height-20:point.y-20):viewport.height-(bottom||72)-anchorSize.height-24;
  const rootStyle=point?{left:point.x,top:point.y,bottom:'auto',right:'auto'}:bottom===null?undefined:{bottom,'--quota-bottom':`${bottom}px`};
  return <aside ref={root} className={`quota-float quota-${position}${dragging?' is-dragging':''}`} style={rootStyle} aria-label="账号额度">
    {open&&<div className={`quota-panel ${panelDown?'opens-down':'opens-up'}`} style={{left:panelLeft,right:panelLeft===undefined?0:undefined,maxHeight:Math.max(0,Math.min(560,panelHeight))}} id="quota-float-panel" role="region" aria-label="账号额度详情"><header className="quota-panel-heading"><span><Gauge size={16}/><strong>账号额度</strong></span><div><button type="button" className="quota-icon-button quota-drag-handle" aria-label="拖动额度浮动条" {...dragHandlers}><GripVertical size={16}/></button><button type="button" className="quota-icon-button" onClick={close} aria-label="收起额度面板"><X size={16}/></button></div></header>
      <p className="quota-pin-hint">勾选要在浮动条中常驻的额度项{pins.length?` · 已选 ${pins.length} 项`:''}</p>
      {quota.error&&<p role="status">{quota.error}</p>}
      {sources.map(source=><QuotaSource key={source.sourceId} source={source} account={accounts.find(a=>a.sourceId===source.sourceId)} refreshing={refreshingSources.includes(source.sourceId)} onRefresh={quota.refresh} pins={pins} onPinChange={pinChange}/>)}
      <footer className="quota-panel-footer">{pins.length?<button type="button" onClick={()=>setQuotaPreferences({pins:[]})}>恢复自动选择</button>:<span>未勾选时自动显示最紧张额度</span>}<button type="button" disabled={refreshingSources.length>0} onClick={()=>quota.refresh()}><RefreshCw size={12}/>刷新全部</button></footer></div>}
    <button ref={trigger} type="button" {...dragHandlers} className={`quota-capsule ${pins.length?'is-multi':tightest?.reached||tightest?.remainingPercent<5?'quota-danger':tightest?.remainingPercent<20?'quota-warning':''}`} aria-expanded={open} aria-controls="quota-float-panel" aria-label={`${pins.length?pinned.map(item=>`${pinLabel(item)} · ${bucketValue(item.bucket)}${item.bucket?.stale?' · 待更新':''}`).join('；'):text}${partial?' · 部分未更新':''}`} title="点击展开额度详情，拖动可调整位置" onClick={event=>{if(suppressClick.current&&event.detail>0){suppressClick.current=false;return;}suppressClick.current=false;setOpen(v=>!v);}}>
      {pins.length?<>
        <span className="quota-pinned-items">{pinned.map((item,index)=>{
          const percent=item.bucket?.remainingPercent, reached=percent===0, level=percent==null?null:reached||percent<5?'danger':percent<20?'warning':'normal';
          const value=!item.bucket?'待更新':reached?'已满':percent!=null?`${Math.round(percent)}%`:bucketValue(item.bucket);
          const platform=pinPlatform(item),continued=index>0&&pinPlatform(pinned[index-1])===platform;
          return <span key={JSON.stringify([item.sourceId,item.bucketId])} className={`quota-pinned-item${item.bucket?.stale?' is-stale':''}${continued?' is-continued':''}`} data-level={level||undefined} title={`${pinLabel(item)} · ${bucketValue(item.bucket)}${resetHint(item.bucket)}${item.bucket?.stale?' · 待更新':''}`}>
            <span className="quota-pill-label" data-short={pinShortLabel(item)}>{platform}</span>
            <span className="quota-pill-window">{pinWindowShort(item)}</span>
            <span className="quota-pill-track" aria-hidden="true">{percent!=null&&<span className="quota-pill-fill" style={{width:`${Math.max(0,Math.min(100,percent))}%`}}/>}</span>
            <strong>{value}</strong>
          </span>;
        })}</span>
      </>:<><GripVertical className="quota-grip" size={13}/><span className="quota-status-dot"/><span className="quota-capsule-text">{text}</span>{partial&&<span className="quota-partial-dot" title="部分未更新"/>}<ChevronDown size={13} className={open?'is-open':''}/></>}
    </button>
  </aside>;
}
