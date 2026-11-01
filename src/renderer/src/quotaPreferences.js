import { useSyncExternalStore } from 'react';
const cookie = name => { try { return document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${name}=`))?.slice(name.length+1); } catch { return ''; } };
const savedPoint = cookie('selfWikiQuotaPoint')?.split(',').map(Number);
function savedPins(){try{const entries=JSON.parse(decodeURIComponent(cookie('selfWikiQuotaPins')||'[]'));return Array.isArray(entries)?entries.filter(p=>Array.isArray(p)&&p.length===2&&p.every(id=>typeof id==='string')):[];}catch{return [];}}
let value={enabled:cookie('selfWikiQuota')==='on',position:cookie('selfWikiQuotaPosition')==='right'?'right':'left',point:savedPoint?.length===2&&savedPoint.every(n=>Number.isFinite(n)&&n>=0)?{x:savedPoint[0],y:savedPoint[1]}:null,pins:savedPins()};
const listeners=new Set();
export function setQuotaPreferences(update) {
  value={...value,...update};
  if(Object.hasOwn(update,'position')&&!Object.hasOwn(update,'point'))value.point=null;
  try { document.cookie=`selfWikiQuota=${value.enabled?'on':'off'}; Path=/; Max-Age=31536000; SameSite=Strict`; document.cookie=`selfWikiQuotaPosition=${value.position}; Path=/; Max-Age=31536000; SameSite=Strict`; } catch { /* In-memory preferences remain usable. */ }
  try {document.cookie=`selfWikiQuotaPoint=${value.point?`${Math.round(value.point.x)},${Math.round(value.point.y)}`:''}; Path=/; Max-Age=31536000; SameSite=Strict`;}catch{/* Keep dragging available without cookies. */}
  try {document.cookie=`selfWikiQuotaPins=${encodeURIComponent(JSON.stringify(value.pins))}; Path=/; Max-Age=31536000; SameSite=Strict`;}catch{/* Selection remains available in memory. */}
  for(const listener of listeners)listener();
}
const subscribe = listener => {listeners.add(listener);return ()=>listeners.delete(listener);};
export function useQuotaPreferences(){return useSyncExternalStore(subscribe,()=>value);}
