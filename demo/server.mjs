import {createCheckout} from './checkout-service.mjs';
import {CheckoutError} from './checkout-model.mjs';
import {createMenus} from './menu-service.mjs';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {callReadOnlyTool,callCheckoutTool,safeMessage} from '../scripts/mcp-discovery.mjs';
import {normalizeMenu,normalizeDetail} from './menu-adapter.mjs';
const root=new URL('../',import.meta.url),dist=new URL('./dist/',import.meta.url);
const port=Number(process.env.FANQIAN_PORT||4173);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local port');
const origin='http://127.0.0.1:'+port;
const allowed=new Map([['/',['index.html','text/html']],['/style.css',['style.css','text/css']],['/app.mjs',['app.mjs','text/javascript']],['/checkout.mjs',['checkout.mjs','text/javascript']],['/stores.mjs',['stores.mjs','text/javascript']],['/domain.mjs',['domain.mjs','text/javascript']],['/food-placeholder.svg',['food-placeholder.svg','image/svg+xml']]]);
async function token(){return process.env.MCD_MCP_TOKEN||parseEnv(await readFile(new URL('.env.local',root),'utf8')).MCD_MCP_TOKEN;}
async function call(name,args,options={}){return ['query-nearby-stores','query-meals','query-meal-detail'].includes(name)?callReadOnlyTool(await token(),name,args):callCheckoutTool(await token(),name,args,options);}
const originalStores=JSON.parse(await readFile(new URL('.local/stores.json',root),'utf8')).result.structuredContent.data;
const store=originalStores.find(s=>s.storeCode==='1980064');
if(!store)throw new Error('Run the public store query before starting');
let remembered=[];try{remembered=JSON.parse(await readFile(new URL('.local/known-stores.json',root),'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('Saved store data invalid');}
let storeSaving=Promise.resolve();
const registry=createMenus({
 initialStores:[...originalStores,...remembered],initialMenu:normalizeMenu(JSON.parse(await readFile(new URL('.local/meals.json',root),'utf8')),store),call,
 persist:async rows=>{const text=JSON.stringify(rows);storeSaving=storeSaving.catch(()=>{}).then(async()=>{await mkdir(new URL('.local/',root),{recursive:true});await writeFile(new URL('.local/known-stores.tmp',root),text);await rename(new URL('.local/known-stores.tmp',root),new URL('.local/known-stores.json',root));});await storeSaving;}
});
let checkoutSaving=Promise.resolve();
const checkout=createCheckout({
 store,getStore:registry.getStore,getMenu:code=>registry.menu(code),call,
 load:async()=>{
  try{const v=JSON.parse(await readFile(new URL('.local/orders.json',root),'utf8'));
   if(!v||typeof v!=='object'||Array.isArray(v))throw new Error();
   for(const[id,e]of Object.entries(v)){
    if(!/^[0-9a-f-]{36}$/i.test(id)||!e||!['pending','unknown','created','rejected'].includes(e.state))throw new Error();
    if(e.state==='created'&&(!e.receipt||typeof e.receipt.orderId!=='string'||!/^[A-Za-z0-9_.-]{1,128}$/.test(e.receipt.orderId)))throw new Error();
   }return v;
  }catch(e){if(e.code==='ENOENT')return {};throw new CheckoutError('本地订单日志无法读取，已停止下单以避免重复订单。',503);}
 },
 save:async data=>{
  const write=async()=>{await mkdir(new URL('.local/',root),{recursive:true});await writeFile(new URL('.local/orders.tmp',root),JSON.stringify(data),{mode:0o600});await rename(new URL('.local/orders.tmp',root),new URL('.local/orders.json',root));};
  checkoutSaving=checkoutSaving.catch(()=>{}).then(write);await checkoutSaving;
 }
});
function send(response,status,data,type='application/json; charset=utf-8'){
 response.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'self'; img-src 'self' https://menu-img.mcd.cn; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
 response.end(type.startsWith('application/json')?JSON.stringify(data):data);
}
async function readBody(request,fields){
 if(request.headers.origin!==origin||!request.headers['content-type']?.startsWith('application/json'))throw new CheckoutError('请从本地页面操作。',403);
 let text='',length=0;for await(const chunk of request){length+=chunk.length;if(length>16384)throw new CheckoutError('请求过大。',413);text+=chunk;}
 let data;try{data=JSON.parse(text);}catch{throw new CheckoutError('请求格式无效。');}
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!fields.includes(k)))throw new CheckoutError('请求参数无效。');return data;
}
const server=createServer(async(request,response)=>{
 try{
  if(request.headers.host!==new URL(origin).host||(request.headers.origin&&request.headers.origin!==origin))return send(response,403,{error:'仅允许本地页面访问'});
  const url=new URL(request.url,origin),code=url.searchParams.get('storeCode')||store.storeCode;
  if(request.method==='POST'&&url.pathname==='/api/stores/search')return send(response,200,await registry.search(await readBody(request,['city','keyword'])));
  if(request.method==='GET'&&url.pathname==='/api/menu')return send(response,200,await registry.menu(code));
  if(request.method==='POST'&&url.pathname==='/api/refresh'){const d=await readBody(request,['storeCode']);return send(response,200,await registry.menu(d.storeCode||store.storeCode,{refresh:true}));}
  if(request.method==='POST'&&url.pathname==='/api/checkout/quote')return send(response,200,await checkout.quote(await readBody(request,['code','quantity','intentId','storeCode'])));
  if(request.method==='POST'&&url.pathname==='/api/checkout/coupon')return send(response,200,await checkout.choose(await readBody(request,['quoteId','couponKey'])));
  if(request.method==='POST'&&url.pathname==='/api/checkout/submit')return send(response,200,await checkout.submit(await readBody(request,['quoteId','takeWayCode','confirmed'])));
  if(request.method==='GET'&&url.pathname==='/api/checkout/status'){
   const id=url.searchParams.get('intentId');if(!/^[0-9a-f-]{36}$/i.test(id||''))throw new CheckoutError('订单标识无效。');
   return send(response,200,await checkout.status(id,{refresh:url.searchParams.get('refresh')==='1'}));
  }
  if(request.method==='GET'&&url.pathname==='/api/detail'){
   const menu=await registry.menu(code),meal=url.searchParams.get('code');
   if(!menu.meals.some(m=>m.id===meal))throw new CheckoutError('请从当前门店签池选择餐品。');
   return send(response,200,normalizeDetail(await call('query-meal-detail',{storeCode:code,code:meal,orderType:1,beType:1})));
  }
  if(request.method==='GET'&&allowed.has(url.pathname)){const[file,type]=allowed.get(url.pathname);return send(response,200,await readFile(new URL(file,dist)),type+'; charset=utf-8');}
  send(response,404,{error:'页面不存在'});
 }catch(error){send(response,error instanceof CheckoutError?error.status:502,{error:error instanceof CheckoutError?error.message:safeMessage(error)});}
});
server.listen(port,'127.0.0.1',()=>console.log('饭签本地演示 Local: '+origin));
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'本地端口已被占用。':'本地预览启动失败。');process.exitCode=1;});
