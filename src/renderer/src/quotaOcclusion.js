import { useEffect,useSyncExternalStore } from 'react';
const tokens=new Set(),listeners=new Set();
export function registerQuotaOcclusion(){const token=Symbol();tokens.add(token);for(const f of listeners)f();let released=false;return()=>{if(released)return;released=true;tokens.delete(token);for(const f of listeners)f();};}
export function useQuotaOcclusion(active=true){useEffect(()=>active?registerQuotaOcclusion():undefined,[active]);}
export function useQuotaOccluded(){return useSyncExternalStore(f=>{listeners.add(f);return()=>listeners.delete(f);},()=>tokens.size>0);}
