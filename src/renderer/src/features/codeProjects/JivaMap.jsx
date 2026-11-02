import {useEffect,useRef} from 'react';
import {ReactFlow,Handle,Position,MarkerType,Controls} from '@xyflow/react';
import {Monitor,PanelsTopLeft,Route,Layers,Database,Bot} from 'lucide-react';
import MindElixir from 'mind-elixir';
import '@xyflow/react/dist/style.css';
import 'mind-elixir/style.css';
import {jivaModules,jivaRelations} from './jivaGuide.js';
import {useProjectTheme} from './useProjectTheme.js';

const icons={desktop:Monitor,ui:PanelsTopLeft,http:Route,service:Layers,storage:Database,agent:Bot};
function ModuleContent({module}) {
  const Icon=icons[module.id];
  return <><span className="jiva-module-icon"><Icon size={21}/></span><span><small>{module.tag}</small><strong>{module.title}</strong><code>{module.directory}</code></span></>;
}
function ModuleNode({data}) {
  return <button className={`jiva-module ${data.selected?'is-selected':''} ${data.muted?'is-muted':''}`} onClick={event=>{event.stopPropagation();data.onSelect(data.module.id);}} aria-label={`查看${data.module.title}`} aria-pressed={data.selected}>
    <ModuleContent module={data.module}/>
    <Handle type="target" position={Position.Left} id="in"/><Handle type="source" position={Position.Right} id="out"/>
    <Handle type="target" position={Position.Top} id="top-in"/><Handle type="source" position={Position.Bottom} id="bottom-out"/>
    <Handle type="target" position={Position.Bottom} id="bottom-in"/><Handle type="source" position={Position.Top} id="top-out"/>
  </button>;
}
const nodeTypes={module:ModuleNode};
export function JivaMap({selected,onSelect,journey}) {
  const relevant=new Set(journey?.steps.map(s=>s.module));
  const nodes=jivaModules.map(module=>({id:module.id,type:'module',position:{x:module.x/270*300,y:module.y},data:{module,onSelect,selected:selected===module.id,muted:journey&&!relevant.has(module.id)}}));
  const edges=jivaRelations.map((edge,i)=>{
    const active=!journey||(relevant.has(edge.source)&&relevant.has(edge.target));
    return {...edge,id:String(i),type:'smoothstep',sourceHandle:edge.source==='desktop'?'top-out':edge.source==='service'?'bottom-out':'out',targetHandle:edge.source==='desktop'?'bottom-in':edge.target==='storage'?'top-in':'in',label:edge.label,markerEnd:{type:MarkerType.ArrowClosed},style:{stroke:active?'var(--accent)':'var(--line-strong)',strokeWidth:active?1.6:1,opacity:active?1:.3},labelStyle:{fill:'var(--muted)',fontSize:12},labelBgStyle:{fill:'var(--panel)'},labelBgPadding:[8,5]};
  });
  return <div className="jiva-map" aria-label="Jiva 项目架构图"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={(_,node)=>onSelect(node.id)} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} fitView fitViewOptions={{padding:.1}} minZoom={.35} maxZoom={1.5}><Controls showInteractive={false}/></ReactFlow><div className="jiva-mobile-map" role="group" aria-label="Jiva 模块列表">{jivaModules.map(module=><button key={module.id} className="jiva-mobile-module" aria-label={`查看${module.title}`} aria-pressed={selected===module.id} onClick={()=>onSelect(module.id)}><ModuleContent module={module}/></button>)}<p>React 界面 → HTTP 入口 → 应用服务 → 本地存储</p></div><span className="jiva-map-hint">点一个模块，查看职责和源码</span></div>;
}

export function JivaMindMap({onSelect}) {
  const ref=useRef(null),latest=useRef(onSelect),theme=useProjectTheme();latest.current=onSelect;
  useEffect(()=>{
    const mind=new MindElixir({el:ref.current,direction:MindElixir.SIDE,alignment:'nodes',editable:false,contextMenu:false,toolBar:false,keypress:false,theme:theme==='dark'?MindElixir.DARK_THEME:MindElixir.THEME});
    mind.init({nodeData:{id:'root',topic:'Jiva',root:true,children:jivaModules.map(m=>({id:m.id,topic:m.title,expanded:false,children:m.files.map((f,i)=>({id:`${m.id}:${i}`,topic:f.label}))}))},linkData:{}});
    const frame=requestAnimationFrame(()=>mind.scaleFit());
    const resize=new ResizeObserver(()=>mind.scaleFit());resize.observe(ref.current);
    mind.bus.addListener('selectNodes',nodes=>{const id=nodes[0]?.id?.split(':')[0];if(jivaModules.some(m=>m.id===id))latest.current(id);});
    return ()=>{cancelAnimationFrame(frame);resize.disconnect();mind.destroy();};
  },[theme]);
  return <div ref={ref} className="jiva-mind" aria-label="Jiva 模块脑图"/>;
}
