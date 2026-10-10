import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { discoverTools, validateToken, DiscoveryError, safeMessage } from './mcp-discovery.mjs';

const root = new URL('../', import.meta.url);
try {
  let token = process.env.MCD_MCP_TOKEN;
  if (!token) {
    try {
      const text = await readFile(new URL('.env.local', root), 'utf8');
      token = parseEnv(text).MCD_MCP_TOKEN;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new DiscoveryError('CONFIG_ERROR');
    }
  }
  token = validateToken(token);
  if (process.argv.includes('--check-config')) {
    console.log('本地 Token 已配置；未联网，也未显示 Token。');
  } else {
    console.log('正在只读连接麦当劳 MCP 并读取工具列表……');
    const snapshot = await discoverTools(token);
    try {
      await mkdir(new URL('.local/', root), { recursive: true });
      await writeFile(new URL('.local/mcp-tools.json', root),
        JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
    } catch { throw new DiscoveryError('OUTPUT_ERROR'); }
    console.log('连接成功，可用工具数量：' + snapshot.tools.length);
    console.log('本地工具说明已保存：' + fileURLToPath(new URL('.local/mcp-tools.json', root)));
    console.log('此次未调用任何业务工具，未查询个人资料、领券、创建订单或支付。');
  }
} catch (error) {
  console.error(safeMessage(error));
  process.exitCode = 1;
}
