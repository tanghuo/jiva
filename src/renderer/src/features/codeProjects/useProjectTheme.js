import {useEffect,useState} from 'react';

// Graph engines need a theme value rather than just the app's CSS variables.
export function useProjectTheme() {
  const read=()=>getComputedStyle(document.documentElement).colorScheme==='dark'?'dark':'light';
  const [theme,setTheme]=useState(read);
  useEffect(()=>{
    const update=()=>setTheme(read()),observer=new MutationObserver(update),media=matchMedia('(prefers-color-scheme: dark)');
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    media.addEventListener('change',update);update();
    return ()=>{observer.disconnect();media.removeEventListener('change',update);};
  },[]);
  return theme;
}
