import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chatgptWebImageExecutor, comfyuiImageExecutor, grokBuildImageExecutor } from './executorsPort.js';
import { imageExecutorDefinition } from '../../shared/domain/imageGeneration.js';

export async function probeImageGeneration(config, dataDir, value = {}) {
  const definition = imageExecutorDefinition(value.executor ?? config.executor);
  const adapters = { 'chatgpt-web': [chatgptWebImageExecutor, 'chatgptWeb'], comfyui: [comfyuiImageExecutor, 'comfyui'], 'grok-build': [grokBuildImageExecutor, 'grokBuild'] };
  const registration = adapters[definition.id];
  if (!registration) return { available: false, message: '请在 Agent 工作台选择此引擎，读取可用模型并检查连接。' };
  const workspace = path.join(dataDir, 'image-probe');
  await mkdir(workspace, { recursive: true });
  return registration[0].probe(structuredClone(config[registration[1]]), workspace);
}
