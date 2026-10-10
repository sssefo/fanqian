import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { callReadOnlyTool, validateToken, safeMessage } from './mcp-discovery.mjs';
import { normalizeMenu } from '../demo/menu-adapter.mjs';

// Fetch only public menus. Validate both snapshots before replacing either file.
export async function setupMenu({ root = new URL('../', import.meta.url), token, call = callReadOnlyTool }) {
  const credential = validateToken(token);
  const stores = await call(credential, 'query-nearby-stores', {
    city: '呼和浩特', keyword: '万达广场', searchType: 2, beType: 1,
  });
  const rows = stores?.result?.structuredContent;
  const store = rows?.success === true && Array.isArray(rows.data)
    ? rows.data.find(s => s.storeCode === '1980064') : null;
  if (!store) throw new Error('默认新华东街门店未返回，未更新快照。请稍后重试。');
  const meals = await call(credential, 'query-meals', { storeCode: store.storeCode, orderType: 1, beType: 1 });
  const menu = normalizeMenu(meals, store);
  await mkdir(new URL('.local/', root), { recursive: true });
  for (const [name, snapshot] of [['stores', stores], ['meals', meals]]) {
    const temporary = new URL(`.local/${name}.setup.tmp`, root);
    await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, new URL(`.local/${name}.json`, root));
  }
  return { name: store.storeName, count: menu.meals.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = new URL('../', import.meta.url);
    const token = process.env.MCD_MCP_TOKEN || parseEnv(await readFile(new URL('.env.local', root), 'utf8')).MCD_MCP_TOKEN;
    const result = await setupMenu({ root, token });
    console.log(`菜单初始化成功：${result.name}，${result.count}个签池选项。运行 npm run dev 开始体验。`);
  } catch (error) {
    console.error('菜单初始化失败。请配置 .env.local，然后运行 npm run setup。');
    console.error(safeMessage(error));
    process.exitCode = 1;
  }
}
