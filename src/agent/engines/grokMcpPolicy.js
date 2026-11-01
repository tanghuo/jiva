// Only log an allowlisted, bounded summary; URLs, commands, arguments, env
// values and tool definitions may contain credentials or user content.
function catalogDiagnostics(catalog, definition, reason) {
  const label = value => typeof value === 'string' ? value.slice(0, 120) : null;
  const servers = Array.isArray(catalog?.servers) ? catalog.servers : [];
  return {
    reason, expectedName: label(definition?.name), transport: definition ? definition.serverId ? 'acp' : 'http' : 'none',
    resolved: typeof catalog?.sessionMcpResolved === 'boolean' ? catalog.sessionMcpResolved : null,
    serverCount: servers.length, omittedServers: Math.max(0, servers.length - 20),
    servers: servers.slice(0, 20).map(server => ({
      name: label(server?.name), type: label(server?.type),
      nameMatches: server?.name === definition?.name,
      commandEmpty: server?.command === '', urlMatches: !!definition?.url && server?.url === definition.url,
      argsCount: Array.isArray(server?.args) ? server.args.length : null,
      envCount: Array.isArray(server?.env) ? server.env.length : null,
      sessionPresent: !!server?.session, enabled: typeof server?.session?.enabled === 'boolean' ? server.session.enabled : null,
      blocked: !!server?.session?.blockedReason, status: label(server?.session?.status),
    })),
  };
}

export function verifyWorkbenchMcpCatalog(catalog, definition) {
  const fail = (reason, message) => { throw Object.assign(new Error(message), { mcpDiagnostics: catalogDiagnostics(catalog, definition, reason) }); };
  if (!catalog || !Array.isArray(catalog.servers) || catalog.sessionMcpResolved === false) fail('catalog_not_ready', 'Grok 应用工具目录尚未就绪');
  const enabled = catalog.servers.filter(server => server.session?.enabled !== false && !server.session?.blockedReason);
  if (!definition) {
    if (enabled.length) fail('unexpected_servers_without_tools', 'Grok 会话加载了其他 MCP；为保持工作台权限范围，本次不会发送任务');
    return { tools: [], transport: 'none' };
  }
  // The pinned CLI represents session-only SDK servers as an empty stdio
  // placeholder. The namespace is fresh and unpredictable for each connection.
  if (definition.serverId) {
    if (!enabled.length) fail('sdk_server_missing', 'Grok 未连接工作台应用工具');
    if (enabled.length !== 1 || enabled[0].name !== definition.name || enabled[0].type !== 'stdio' || enabled[0].command !== '' || enabled[0].args?.length || enabled[0].env?.length) fail('sdk_server_mismatch', 'Grok 会话加载了其他 MCP；为保持工作台权限范围，本次不会发送任务');
    if (enabled[0].session.status !== 'ready') fail('sdk_server_not_ready', 'Grok 未连接工作台应用工具');
    return { server: definition.name, tools: enabled[0].session.tools || [], transport: 'acp' };
  }
  if (enabled.some(server => server.name !== definition.name || !definition.serverId && (server.type !== 'http' || server.url !== definition.url))) fail('http_server_mismatch', 'Grok 会话加载了其他 MCP；为保持工作台权限范围，本次不会发送任务');
  const own = enabled.find(server => server.name === definition.name);
  if (!own || own.session?.status !== 'ready') fail('http_server_not_ready', 'Grok 未连接工作台应用工具');
  return { server: own.name, tools: (own.session.tools || []).filter(tool => tool.enabled !== false).map(tool => tool.name) };
}
