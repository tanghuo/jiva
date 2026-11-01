import { pathToFileURL } from 'node:url';

export function acpFileReferences(files) {
  return files.map(file => ({ type: 'resource_link', uri: pathToFileURL(file.path).href, name: file.name, mimeType: file.mimeType, size: file.size }));
}

// Codex app-server has no generic file input. `mention` selects apps/plugins,
// so local attachments use explicit paths for its native file tools to read.
export function codexFileReferences(files) {
  return files.map(file => ({ type: 'text', text: `用户文件附件，请使用原生工具读取原文件：${JSON.stringify(file)}` }));
}
