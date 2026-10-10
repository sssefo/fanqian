import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverTools, DiscoveryError, validateToken, safeMessage, ENDPOINT } from '../scripts/mcp-discovery.mjs';

const TOKEN = 'test-token-not-real';
const init = { protocolVersion: '2025-03-26', capabilities: { tools: {} } };
const tool = name => ({ name, description: 'Public tool metadata', inputSchema: { type: 'object', properties: {} } });
const jsonReply = (id, result, headers = {}) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
  headers: { 'content-type': 'application/json', ...headers },
});
function mock(pageHandler, initialize = init) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, ...options, body });
      if (body.method === 'initialize') return jsonReply(body.id, initialize, { 'mcp-session-id': 'private-session-id' });
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      assert.equal(body.method, 'tools/list');
      return pageHandler(body, calls);
    },
  };
}

test('only initialization and discovery; official endpoint, auth, session and redirects', async () => {
  const m = mock(body => jsonReply(body.id, { tools: [tool('query-meals')] }));
  const result = await discoverTools(TOKEN, m);
  assert.equal(result.tools[0].name, 'query-meals');
  assert.deepEqual(m.calls.map(x => x.body.method), ['initialize', 'notifications/initialized', 'tools/list']);
  for (const call of m.calls) {
    assert.equal(call.url, ENDPOINT);
    assert.equal(call.redirect, 'error');
    assert.equal(call.headers.Authorization, 'Bearer ' + TOKEN);
    assert.equal(call.headers.Accept, 'application/json, text/event-stream');
  }
  assert.equal(m.calls[0].headers['Mcp-Session-Id'], undefined);
  assert.equal(m.calls[2].headers['Mcp-Session-Id'], 'private-session-id');
  assert.equal(JSON.stringify(result).includes('private-session-id'), false);
});

test('pagination sends the returned cursor and accumulates all tools', async () => {
  const m = mock(body => jsonReply(body.id, body.params.cursor === undefined
    ? { tools: [tool('one')], nextCursor: 'next' }
    : { tools: [tool('two')] }));
  const result = await discoverTools(TOKEN, m);
  assert.deepEqual(result.tools.map(x => x.name), ['one', 'two']);
  assert.deepEqual(m.calls[3].body.params, { cursor: 'next' });
});

test('fragmented SSE handles notifications, UTF-8 and CRLF before the matching response', async () => {
  const m = mock(body => {
    const data = 'event: message\r\ndata: ' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress' })
      + '\r\n\r\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [
        { ...tool('query-meals'), description: '餐品菜单' },
      ] } }) + '\r\n\r\n';
    const bytes = new TextEncoder().encode(data);
    let offset = 0;
    return new Response(new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) { controller.close(); return; }
        controller.enqueue(bytes.slice(offset, offset + 1));
        offset++;
      },
    }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  });
  const result = await discoverTools(TOKEN, m);
  assert.equal(result.tools[0].description, '餐品菜单');
});

test('SSE returns without waiting for the server to close the stream', async () => {
  let cancelled = false;
  const m = mock(body => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: ' +
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [] } }) + '\n\n'));
    },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  const result = await discoverTools(TOKEN, m);
  assert.deepEqual(result.tools, []);
  assert.equal(cancelled, true);
});

test('missing and placeholder tokens fail before any network request', async () => {
  for (const token of [undefined, '', 'REPLACE_WITH_YOUR_TOKEN', '${MCD_MCP_TOKEN}']) {
    await assert.rejects(discoverTools(token, { fetchImpl() { assert.fail('must not send'); } }),
      error => error.code === 'TOKEN_MISSING');
  }
  assert.throws(() => validateToken('Bearer abc'), error => error.code === 'TOKEN_INVALID');
});

test('unsupported negotiated version stops before initialized or tools/list', async () => {
  const m = mock(() => assert.fail(), { ...init, protocolVersion: '2099-01-01' });
  await assert.rejects(discoverTools(TOKEN, m), error => error.code === 'PROTOCOL_UNSUPPORTED');
  assert.equal(m.calls.length, 1);
});

test('missing tools capability is not reported as a successful discovery', async () => {
  const m = mock(() => assert.fail(), { ...init, capabilities: {} });
  await assert.rejects(discoverTools(TOKEN, m), error => error.code === 'TOOLS_UNAVAILABLE');
});

test('authentication errors never surface response bodies or credentials', async () => {
  await assert.rejects(discoverTools(TOKEN, {
    fetchImpl: async () => new Response('Token was: ' + TOKEN, { status: 401 }),
  }), error => error.code === 'HTTP_401' && !safeMessage(error).includes(TOKEN));
});

test('raw network errors and timeout errors are sanitized', async () => {
  await assert.rejects(discoverTools(TOKEN, {
    fetchImpl: async () => { throw new Error('headers=' + TOKEN); },
  }), error => error.code === 'NETWORK_ERROR' && !safeMessage(error).includes(TOKEN));
  await assert.rejects(discoverTools(TOKEN, {
    fetchImpl: async () => { throw new DOMException(TOKEN, 'TimeoutError'); },
  }), error => error.code === 'TIMEOUT');
  assert.equal(safeMessage(new Error(TOKEN)).includes(TOKEN), false);
});

test('RPC errors discard error text', async () => {
  const m = mock(body => new Response(JSON.stringify({
    jsonrpc: '2.0', id: body.id, error: { code: -32000, message: TOKEN },
  }), { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(discoverTools(TOKEN, m), error => error.code === 'RPC_ERROR' && !error.message.includes(TOKEN));
});

test('unknown IDs and malformed tool definitions fail safely', async () => {
  for (const handler of [
    body => jsonReply(body.id + 50, { tools: [] }),
    body => jsonReply(body.id, { tools: [{ name: 'bad name', inputSchema: {} }] }),
    body => jsonReply(body.id, { tools: [tool('one'), tool('one')] }),
    body => jsonReply(body.id, { tools: 'not an array' }),
  ]) {
    await assert.rejects(discoverTools(TOKEN, mock(handler)), error => error.code === 'INVALID_RESPONSE');
  }
});

test('repeating pagination cursors cannot cause an endless request loop', async () => {
  const m = mock(body => jsonReply(body.id, { tools: [], nextCursor: 'repeat' }));
  await assert.rejects(discoverTools(TOKEN, m), error => error.code === 'INVALID_PAGINATION');
  assert.equal(m.calls.length, 4);
});

test('discovery snapshots redact accidentally echoed credentials and session IDs', async () => {
  const m = mock(body => jsonReply(body.id, { tools: [
    { ...tool('query-meals'), description: TOKEN + ' private-session-id' },
  ] }));
  const result = await discoverTools(TOKEN, m);
  const text = JSON.stringify(result);
  assert.equal(text.includes(TOKEN), false);
  assert.equal(text.includes('private-session-id'), false);
  assert.match(result.tools[0].description, /REDACTED/);
});

test('unexpected HTML response does not get printed', async () => {
  const m = mock(() => new Response('<html>' + TOKEN + '</html>', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(discoverTools(TOKEN, m), error => error.code === 'INVALID_RESPONSE');
});

test('oversized service response is bounded', async () => {
  const m = mock(() => new Response(' '.repeat(4 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(discoverTools(TOKEN, m), error => error.code === 'RESPONSE_TOO_LARGE');
});

test('read-only business calls pass exact public-place arguments', async () => {
  const { callReadOnlyTool } = await import('../scripts/mcp-discovery.mjs');
  const calls = [];
  const args = { city: '呼和浩特', keyword: '万达广场', beType: 1, searchType: 2 };
  const result = await callReadOnlyTool(TOKEN, 'query-nearby-stores', args, {
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      if (body.method === 'initialize') return jsonReply(body.id, init);
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      assert.equal(url, ENDPOINT);
      assert.equal(body.method, 'tools/call');
      return jsonReply(body.id, { content: [{ type: 'text', text: '{"stores":[]}' }] });
    },
  });
  assert.deepEqual(calls[2].params, { name: 'query-nearby-stores', arguments: args });
  assert.equal(result.tool, 'query-nearby-stores');
});

test('order, coupon and account calls are rejected before networking', async () => {
  const { callReadOnlyTool } = await import('../scripts/mcp-discovery.mjs');
  for (const name of ['create-order', 'auto-bind-coupons', 'draw-lottery', 'query-my-account']) {
    await assert.rejects(callReadOnlyTool(TOKEN, name, {}, {
      fetchImpl() { assert.fail('must not send'); },
    }), error => error.code === 'TOOL_NOT_ALLOWED');
  }
});

test('private favorites, delivery and injected extra parameters are rejected', async () => {
  const { callReadOnlyTool } = await import('../scripts/mcp-discovery.mjs');
  const bad = [
    ['query-nearby-stores', { city: '呼和浩特', keyword: '万达广场', beType: 1, searchType: 1 }],
    ['query-meals', { storeCode: '123', orderType: 2, beType: 2 }],
    ['query-meals', { storeCode: '123', orderType: 1, beType: 1, beCode: 'unwanted' }],
    ['query-nearby-stores', { city: '呼和浩特', keyword: '', beType: 1, searchType: 2 }],
  ];
  for (const [name, args] of bad) await assert.rejects(callReadOnlyTool(TOKEN, name, args, {
    fetchImpl() { assert.fail('must not send'); },
  }), error => error.code === 'INVALID_ARGUMENTS');
});

test('business tool failures do not masquerade as successful data', async () => {
  const { callReadOnlyTool } = await import('../scripts/mcp-discovery.mjs');
  await assert.rejects(callReadOnlyTool(TOKEN, 'query-meals', { storeCode: '123', orderType: 1, beType: 1 }, {
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.method === 'initialize') return jsonReply(body.id, init);
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      return jsonReply(body.id, { isError: true, content: [{ type: 'text', text: TOKEN }] });
    },
  }), error => error.code === 'TOOL_ERROR' && !safeMessage(error).includes(TOKEN));
});
