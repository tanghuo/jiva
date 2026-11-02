import { useEffect, useRef, useState } from 'react';
import { request } from './api.js';
import './magnetImports.css';

export default function MagnetImportStatus({ hidden, onChanged }) {
  const [notice, setNotice] = useState(null), previous = useRef(null), dismissed = useRef('');
  useEffect(() => {
    let stopped = false, timer;
    async function poll() {
      try {
        const { tasks } = await request('/api/magnet-imports');
        if (stopped) return;
        const changed = tasks.find(t => previous.current?.[t.id] && previous.current[t.id] !== t.state && ['completed', 'confirmation', 'attention', 'failed'].includes(t.state));
        const pending = tasks.filter(t => ['confirmation', 'attention', 'failed'].includes(t.state));
        const signature = pending.map(t => `${t.id}:${t.state}`).join(',');
        if (changed?.state === 'completed') { setNotice({ signature: `done:${changed.id}`, text: `任务 #${changed.id} 导入完成` }); onChanged?.(); }
        else if (pending.length && dismissed.current !== signature) setNotice({ signature, text: `${pending.length} 个磁力导入任务待确认或待处理` });
        else if (!pending.length && !changed) setNotice(current => current?.signature.startsWith('done:') ? current : null);
        previous.current = Object.fromEntries(tasks.map(t => [t.id, t.state]));
      } catch { /* Background polling stays quiet when the service is unavailable. */ }
      if (!stopped) timer = setTimeout(poll, 15000);
    }
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [onChanged]);
  if (hidden || !notice) return null;
  return <aside className="magnet-status" aria-label="磁力导入通知"><p role="status">{notice.text}</p><a href="#imports">查看导入任务</a><button onClick={() => { dismissed.current = notice.signature; setNotice(null); }}>收起</button></aside>;
}
