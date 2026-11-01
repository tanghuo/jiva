// The persisted chat key and engine field remain readable for existing configuration files.
import { elementError } from "../elements.js";
import { validExecutable } from "../executablePath.js";

const compatibleEngines = [{ id: "codex", label: "Codex" }, { id: "grok-build", label: "Grok Build" }];
export const defaultWorkbenchConnectionConfig = () => ({ engine: "codex", grokBuild: { executable: "grok", model: "grok-4.6" } });
export function workbenchConnectionConfig(value = defaultWorkbenchConnectionConfig()) {
  const grok = value?.grokBuild;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["engine", "grokBuild"].includes(key))
      || !compatibleEngines.some((entry) => entry.id === value.engine) || !grok || typeof grok !== "object" || Array.isArray(grok)
      || Object.keys(grok).some((key) => !["executable", "model"].includes(key)) || !validExecutable(grok.executable)
      || /\.(?:cmd|bat)$/i.test(grok.executable.trim()) || typeof grok.model !== "string" || !/^[a-zA-Z0-9][\w.-]{0,99}$/.test(grok.model)) throw elementError("无效的工作台 Grok 程序或模型配置");
  return { engine: value.engine, grokBuild: { executable: grok.executable.trim(), model: grok.model } };
}

