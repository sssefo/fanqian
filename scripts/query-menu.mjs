import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { callReadOnlyTool, safeMessage, DiscoveryError } from './mcp-discovery.mjs';

const root = new URL('../', import.meta.url);
const [action, first, second] = process.argv.slice(2);
const commands = {
  stores: { name: 'query-nearby-stores', args: { city: first, keyword: second, searchType: 2, beType: 1 } },
  meals: { name: 'query-meals', args: { storeCode: first, orderType: 1, beType: 1 } },
  detail: { name: 'query-meal-detail', args: { storeCode: first, code: second, orderType: 1, beType: 1 } },
};
try {
  if (!commands[action]) throw new DiscoveryError('INVALID_ARGUMENTS');
  let token = process.env.MCD_MCP_TOKEN;
  if (!token) {
    try {
      token = parseEnv(await readFile(new URL('.env.local', root), 'utf8')).MCD_MCP_TOKEN;
    } catch { throw new DiscoveryError('CONFIG_ERROR'); }
  }
  const command = commands[action];
  const snapshot = await callReadOnlyTool(token, command.name, command.args);
  await mkdir(new URL('.local/', root), { recursive: true });
  await writeFile(new URL('.local/' + action + '.json', root),
    JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
  console.log('查询成功：' + command.name + '。快照已保存至 .local/' + action + '.json');
} catch (error) {
  console.error(safeMessage(error));
  process.exitCode = 1;
}
