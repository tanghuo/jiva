import { defaultWorkbenchConnectionConfig } from "../../shared/domain/agentWorkbench/connection.js";
export default function WorkbenchConnectionSettings({ value = defaultWorkbenchConnectionConfig(), locked, onChange }) {
  return <fieldset className="settings-group"><legend>工作台 Grok 连接</legend>
    <label>Grok 程序路径<input value={value.grokBuild.executable} disabled={locked} onChange={event => onChange({ ...value, grokBuild: { ...value.grokBuild, executable: event.target.value } })} placeholder="grok" /></label>
    <label>Grok 默认模型<input value={value.grokBuild.model} disabled={locked} onChange={event => onChange({ ...value, grokBuild: { ...value.grokBuild, model: event.target.value } })} /></label>
    <p className="wiki-muted">先在本机运行 grok login。进入 Agent 工作台选择引擎和模型，并检测可用模型。自动整理在「自动整理与检索」单独配置。</p>
  </fieldset>;
}
