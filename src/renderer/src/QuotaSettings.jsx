import { useState } from 'react';
import { request } from './api.js';
import useQuota from './useQuota.js';
import { useQuotaPreferences,setQuotaPreferences } from './quotaPreferences.js';
import { QuotaSource } from './QuotaFloat.jsx';
export function QuotaAppearanceSettings(){const prefs=useQuotaPreferences();return <fieldset className="quota-settings"><legend>账号额度浮动条</legend><label><input type="checkbox" checked={prefs.enabled} onChange={e=>setQuotaPreferences({enabled:e.target.checked})}/>显示额度浮动条</label><label>显示位置<select aria-label="显示位置" value={prefs.position} onChange={e=>setQuotaPreferences({position:e.target.value})}><option value="left">左下</option><option value="right">右下</option></select></label><p className="wiki-muted">也可以直接拖动浮动条，位置会自动保存。</p>{prefs.point&&<button type="button" onClick={()=>setQuotaPreferences({point:null})}>重置浮动条位置</button>}</fieldset>;}
export function QuotaSourceSettings(){
  const quota=useQuota(true,{collect:false}),[error,setError]=useState('');
  async function enabled(source,value){try{await request('/api/quota/config',{method:'PUT',body:JSON.stringify({sourceId:source.sourceId,enabled:value})});setError('');}catch(e){setError(e.message);}}
  return <fieldset className="quota-settings"><legend>账号额度来源</legend><p className="wiki-muted">检测仅执行只读额度请求；浮动条关闭时也可手动检测。Codex、Grok 沿用工作台连接。Gemini 优先读取工作台已连接的 Antigravity 账号额度，关闭桌面端后仍可刷新；尚未连接时尝试已打开的 Antigravity 桌面端。此处不是 Gemini 网页订阅额度。</p>
    {(error||quota.error)&&<p role="alert">{error||quota.error}</p>}
    {quota.snapshot?.sources.map(source=><div key={source.sourceId}><label><input type="checkbox" checked={source.enabled} onChange={e=>enabled(source,e.target.checked)}/>允许 {source.label} 自动采集</label><QuotaSource source={source} account={quota.snapshot.accounts.find(a=>a.sourceId===source.sourceId)} refreshing={quota.snapshot.refreshingSources.includes(source.sourceId)} onRefresh={quota.refresh} actionLabel="检测额度"/></div>)}
  </fieldset>;
}
