import { useCallback,useEffect,useRef,useState } from 'react';
import { apiUrl,request } from './api.js';
export default function useQuota(enabled,{collect=true}={}) {
  const [snapshot,setSnapshot]=useState(null),[error,setError]=useState('');
  const lastRequested=useRef(0),alive=useRef(true),retiredEpochs=useRef(new Set());
  const apply=useCallback(next=>{
    if(!alive.current)return;
    setSnapshot(previous=>{
      if(retiredEpochs.current.has(next.epoch)||previous?.epoch===next.epoch&&previous.revision>next.revision)return previous;
      if(previous&&previous.epoch!==next.epoch)retiredEpochs.current.add(previous.epoch);
      return next;
    });
  },[]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const refresh=useCallback(async(sourceIds,reason='manual')=>{
    try {const next=await request('/api/quota/refresh',{method:'POST',body:JSON.stringify({sourceIds,reason})});apply(next);lastRequested.current=Date.now();if(alive.current)setError('');}
    catch(e){if(alive.current)setError(e.message);}
  },[apply]);
  useEffect(()=>{
    if(!enabled)return;
    let stream,timer,cancelled=false;
    const stop=()=>{stream?.close();stream=null;clearInterval(timer);};
    const start=async(force=false)=>{
      stop();if(document.visibilityState==='hidden'||cancelled)return;
      stream=new EventSource(apiUrl(`/api/quota/events?collect=${collect?'1':'0'}`));
      stream.addEventListener('snapshot',event=>{try{apply(JSON.parse(event.data));setError('');}catch{/* Reconnection supplies a full snapshot. */}});
      stream.onerror=()=>{if(!cancelled)setError('额度连接中断，正在重连');};
      if(collect)timer=setInterval(()=>{void refresh(undefined,'interval');},15*60000);
      try {
        const next=await request('/api/quota');if(cancelled)return;apply(next);
        if(collect&&document.visibilityState!=='hidden'&&(force||Date.now()-lastRequested.current>=15*60000||next.sources.some(s=>s.dirty)))void refresh(undefined,'open');
      } catch(e){if(!cancelled)setError(e.message);}
    };
    const visibility=()=>{if(document.visibilityState==='hidden')stop();else void start();};
    void start(true);document.addEventListener('visibilitychange',visibility);
    return()=>{cancelled=true;stop();document.removeEventListener('visibilitychange',visibility);};
  },[enabled,collect,apply,refresh]);
  return {snapshot,error,refresh};
}
