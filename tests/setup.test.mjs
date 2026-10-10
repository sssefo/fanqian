import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setupMenu } from '../scripts/setup-menu.mjs';
const stores = { result: { structuredContent: { success: true, data: [{ storeCode:'1980064',storeName:'测试门店',address:'测试地址' }] } } };
const meals = { checkedAt:'2026-10-10T00:00:00Z',result: { structuredContent: { success:true,data: {
  categories:[{name:'单人餐',meals:[{code:'meal-1'}]}],
  meals:{'meal-1':{name:'汉堡三件套',currentPrice:30}},
} } } };
test('fresh setup writes usable public snapshots without touching order journal',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fanqian-setup-'));const root=pathToFileURL(dir+'/');
  try {
    const calls=[];
    const result=await setupMenu({root,token:'test-token',call:async(token,name,args)=>{calls.push({name,args});return name==='query-nearby-stores'?stores:meals;}});
    assert.equal(result.count,1);assert.deepEqual(calls.map(c=>c.name),['query-nearby-stores','query-meals']);
    assert.equal(JSON.parse(await readFile(new URL('.local/meals.json',root),'utf8')).result.structuredContent.success,true);
    const journal=new URL('.local/orders.json',root);await writeFile(journal,'{"preserve":true}');
    const old=await readFile(new URL('.local/meals.json',root),'utf8');
    await assert.rejects(setupMenu({root,token:'test-token',call:async(t,n)=>n==='query-nearby-stores'?stores:{}}));
    assert.equal(await readFile(new URL('.local/meals.json',root),'utf8'),old);
    assert.equal(await readFile(journal,'utf8'),'{"preserve":true}');
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('missing token stops setup before any call',async()=>{
  let called=false;await assert.rejects(setupMenu({token:'REPLACE_WITH_YOUR_TOKEN',call:async()=>{called=true;}}));assert.equal(called,false);
});
