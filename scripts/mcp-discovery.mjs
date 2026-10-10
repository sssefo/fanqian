import { validateCheckoutCall } from './checkout-schema.mjs';
// MCP tool discovery and narrowly scoped, read-only public store/menu queries.
// Checkout has a separate validated entry point; public menu calls remain read-only.
export const ENDPOINT = 'https://mcp.mcd.cn';
const VERSION = '2025-03-26';
const MAX_BYTES = 4 * 1024 * 1024;

export class DiscoveryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'DiscoveryError';
    this.code = code;
  }
}

export function validateToken(value) {
  if (typeof value !== 'string') throw new DiscoveryError('TOKEN_MISSING');
  const token = value.trim();
  if (!token || token === 'REPLACE_WITH_YOUR_TOKEN' || token.includes('${')) {
    throw new DiscoveryError('TOKEN_MISSING');
  }
  if (/\s/.test(token) || !/^[\x21-\x7e]+$/.test(token)) {
    throw new DiscoveryError('TOKEN_INVALID');
  }
  return token;
}

function parse(text) {
  try { return JSON.parse(text); }
  catch { throw new DiscoveryError('INVALID_RESPONSE'); }
}

function responseResult(message, id) {
  const messages = Array.isArray(message) ? message : [message];
  const reply = messages.find(item => item && item.id === id);
  if (!reply) return { found: false };
  if (reply.jsonrpc !== '2.0') throw new DiscoveryError('INVALID_RESPONSE');
  if (reply.error) throw new DiscoveryError('RPC_ERROR');
  if (!Object.hasOwn(reply, 'result')) throw new DiscoveryError('INVALID_RESPONSE');
  return { found: true, result: reply.result };
}

async function readReply(response, id) {
  const type = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (!['application/json', 'text/event-stream'].includes(type) || !response.body) {
    throw new DiscoveryError('INVALID_RESPONSE');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) throw new DiscoveryError('RESPONSE_TOO_LARGE');
      }
      buffer += decoder.decode(value, { stream: !done });
      if (type === 'application/json') {
        if (!done) continue;
        const reply = responseResult(parse(buffer), id);
        if (!reply.found) throw new DiscoveryError('INVALID_RESPONSE');
        return reply.result;
      }
      // Normalize complete CRLF sequences; a trailing CR stays buffered.
      buffer = buffer.replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = event.split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue;
        const reply = responseResult(parse(data), id);
        if (reply.found) return reply.result;
      }
      if (done) throw new DiscoveryError('INVALID_RESPONSE');
    }
  } finally {
    try { await reader.cancel(); } catch { /* no raw transport error logging */ }
    reader.releaseLock();
  }
}

async function connectReadOnly(rawToken, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const token = validateToken(rawToken);
  let sessionId = null;
  let sequence = 0;
  const secrets = [token];
  async function post(method, params, notification = false) {
    if (!['initialize', 'notifications/initialized', 'tools/list', 'tools/call'].includes(method)) {
      throw new DiscoveryError('METHOD_NOT_ALLOWED');
    }
    const id = notification ? undefined : ++sequence;
    const headers = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    if (method !== 'initialize') headers['MCP-Protocol-Version'] = VERSION;
    let response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST', headers, redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method,
          ...(params === undefined ? {} : { params }) }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new DiscoveryError('HTTP_' + response.status);
      }
      if (notification) {
        await response.body?.cancel();
        return;
      }
      if (method === 'initialize') {
        sessionId = response.headers.get('mcp-session-id');
        if (sessionId) {
          if (!/^[\x21-\x7e]+$/.test(sessionId)) throw new DiscoveryError('INVALID_RESPONSE');
          secrets.push(sessionId);
        }
      }
      return await readReply(response, id);
    } catch (error) {
      if (error instanceof DiscoveryError) throw error;
      // Never echo response text, headers, URLs from errors or original exception messages.
      throw new DiscoveryError(error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'TIMEOUT' : 'NETWORK_ERROR');
    }
  }

  const initialized = await post('initialize', {
    protocolVersion: VERSION, capabilities: {},
    clientInfo: { name: 'fanqian-discovery', version: '0.1.0' },
  });
  if (initialized?.protocolVersion !== VERSION) throw new DiscoveryError('PROTOCOL_UNSUPPORTED');
  if (!initialized.capabilities?.tools) throw new DiscoveryError('TOOLS_UNAVAILABLE');
  await post('notifications/initialized', undefined, true);

  function redact(value) {
    let json = JSON.stringify(value);
    for (const secret of secrets) json = json.split(JSON.stringify(secret).slice(1, -1)).join('[REDACTED]');
    return JSON.parse(json);
  }
  return { post, redact };
}

export async function discoverTools(rawToken, options = {}) {
  const { post, redact } = await connectReadOnly(rawToken, options);
  const tools = [];
  const names = new Set();
  const cursors = new Set();
  let cursor;
  for (let page = 0; page < 20; page++) {
    const result = await post('tools/list', cursor === undefined ? {} : { cursor });
    if (!result || !Array.isArray(result.tools)) throw new DiscoveryError('INVALID_RESPONSE');
    for (const tool of result.tools) {
      if (!tool || typeof tool.name !== 'string' ||
          !/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name) ||
          !tool.inputSchema || typeof tool.inputSchema !== 'object' ||
          Array.isArray(tool.inputSchema) || names.has(tool.name)) {
        throw new DiscoveryError('INVALID_RESPONSE');
      }
      names.add(tool.name);
      tools.push({
        name: tool.name,
        ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema,
      });
    }
    if (result.nextCursor === undefined) {
      // Store only useful schema data. Do not store server instructions or session headers.
      return redact({ endpoint: ENDPOINT, protocolVersion: VERSION,
        checkedAt: new Date().toISOString(), tools });
    }
    if (typeof result.nextCursor !== 'string' || !result.nextCursor ||
        cursors.has(result.nextCursor)) throw new DiscoveryError('INVALID_PAGINATION');
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new DiscoveryError('TOO_MANY_PAGES');
}

export function validateReadOnlyCall(name, args) {
  const fields = {
    'query-nearby-stores': ['city', 'keyword', 'searchType', 'beType'],
    'query-meals': ['storeCode', 'orderType', 'beType'],
    'query-meal-detail': ['storeCode', 'orderType', 'beType', 'code'],
  };
  const allowed = fields[name];
  if (!allowed) throw new DiscoveryError('TOOL_NOT_ALLOWED');
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).length !== allowed.length ||
      !allowed.every(key => Object.hasOwn(args, key))) throw new DiscoveryError('INVALID_ARGUMENTS');
  if (args.beType !== 1) throw new DiscoveryError('INVALID_ARGUMENTS');
  if (name === 'query-nearby-stores') {
    if (args.searchType !== 2) throw new DiscoveryError('INVALID_ARGUMENTS');
    for (const field of ['city', 'keyword']) {
      if (typeof args[field] !== 'string' || !args[field].trim() ||
          args[field].length > 80 || /[\u0000-\u001f\u007f]/.test(args[field])) {
        throw new DiscoveryError('INVALID_ARGUMENTS');
      }
    }
  } else {
    if (args.orderType !== 1) throw new DiscoveryError('INVALID_ARGUMENTS');
    for (const field of name === 'query-meal-detail' ? ['storeCode', 'code'] : ['storeCode']) {
      if (typeof args[field] !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(args[field])) {
        throw new DiscoveryError('INVALID_ARGUMENTS');
      }
    }
  }
  return { ...args };
}

export async function callReadOnlyTool(token, name, args, options = {}) {
  const validated = validateReadOnlyCall(name, args);
  const { post, redact } = await connectReadOnly(token, options);
  const result = await post('tools/call', { name, arguments: validated });
  if (!result || typeof result !== 'object' ||
      (!Array.isArray(result.content) && !result.structuredContent)) {
    throw new DiscoveryError('INVALID_RESPONSE');
  }
  if (result.isError) throw new DiscoveryError('TOOL_ERROR');
  return redact({ endpoint: ENDPOINT, tool: name, arguments: validated,
    checkedAt: new Date().toISOString(), result });
}

export function safeMessage(error) {
  const messages = {
    TOOL_NOT_ALLOWED: '仅允许公开位置搜索和到店菜单、详情查询。',
    INVALID_ARGUMENTS: '查询参数不符合允许的只读到店查询范围。',
    TOOL_ERROR: '业务工具返回失败，请核对门店、餐品与营业时段。',
    TOKEN_MISSING: '请在 .env.local 中填写 MCD_MCP_TOKEN，或在本机设置同名环境变量。',
    TOKEN_INVALID: 'Token 格式不正确。只填 Token 本身，不要加 Bearer 前缀或换行。',
    HTTP_401: 'Token 无效或已过期，请在麦当劳开放平台检查后重新填写。',
    HTTP_403: '服务拒绝访问，请检查账号授权与服务权限。',
    HTTP_429: '请求过于频繁，请稍后重试。',
    TIMEOUT: '连接超时，请检查网络后重试。',
    NETWORK_ERROR: '网络连接失败，请检查网络。脚本不会跟随重定向发送 Token。',
    PROTOCOL_UNSUPPORTED: '服务返回了尚未支持的协议版本，需要调整连接实现。',
    TOOLS_UNAVAILABLE: '服务没有声明工具列表能力。',
    INVALID_RESPONSE: '服务返回的工具数据或协议响应不符合预期。',
    RPC_ERROR: '服务返回协议错误；未输出响应内容，以免泄露账号信息。',
    INVALID_PAGINATION: '工具列表分页异常，已停止请求。',
    TOO_MANY_PAGES: '工具列表分页超过验证脚本上限，已停止请求。',
    RESPONSE_TOO_LARGE: '服务响应过大，已停止读取。',
    CONFIG_ERROR: '无法读取本地配置，请检查 .env.local 文件。',
    OUTPUT_ERROR: '已读取工具列表，但无法保存本地验证结果。',
  };
  if (!(error instanceof DiscoveryError)) return '验证失败，未输出可能包含凭据的原始错误。';
  return messages[error.code] || (/^HTTP_\d{3}$/.test(error.code)
    ? '服务请求失败（' + error.code + '）。'
    : '验证失败，未输出可能包含凭据的原始错误。');
}

export async function callCheckoutTool(token,name,args,options={}) {
 const validated=validateCheckoutCall(name,args);
 if(name==='create-order'&&options.confirmed!==true)throw new DiscoveryError('ORDER_CONFIRMATION_REQUIRED');
 const {post,redact}=await connectReadOnly(token,options);
 const result=await post('tools/call',{name,arguments:validated});
 if(!result||typeof result!=='object'||result.isError)throw new DiscoveryError('TOOL_ERROR');
 return redact({endpoint:ENDPOINT,tool:name,arguments:validated,checkedAt:new Date().toISOString(),result});
}
