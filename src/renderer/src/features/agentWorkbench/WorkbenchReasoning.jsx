import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function WorkbenchReasoning({ item, live }) {
  const [expanded, setExpanded] = useState(null);
  return <details className="workbench-reasoning" open={expanded ?? live} onToggle={event => {
    if (event.target === event.currentTarget && event.currentTarget.open !== (expanded ?? live)) setExpanded(event.currentTarget.open);
  }}>
    <summary><ChevronRight size={14} /><span>{item.data.kind === 'summary' ? '思考摘要' : '思考过程'}</span>{live && <span role="status">正在思考</span>}</summary>
    <div className="workbench-markdown"><ReactMarkdown skipHtml components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{item.data.text}</ReactMarkdown></div>
  </details>;
}
