import WorkbenchMarkdown from './WorkbenchMarkdown.jsx';

export default function WorkbenchReasoning({ item, live }) {
  const label = item.data.kind === 'summary' ? '思考摘要' : '思考过程';
  const preview = item.data.text.replace(/[*#`>_]/g, '').replace(/\s+/g, ' ').trim();
  return <details className="workbench-reasoning" aria-label={label}>
    <summary><span>{live ? '正在思考' : label}</span><span className="workbench-reasoning-preview">{preview}</span></summary>
    <WorkbenchMarkdown>{item.data.text}</WorkbenchMarkdown>
  </details>;
}
