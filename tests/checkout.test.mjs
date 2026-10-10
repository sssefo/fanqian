import test from 'node:test';
import assert from 'node:assert/strict';
import {createCheckout} from '../demo/checkout-service.mjs';
import {buildItem,normalizePrice,safePaymentLink,normalizeOrder} from '../demo/checkout-model.mjs';
import {validateCheckoutCall} from '../scripts/checkout-schema.mjs';
import {callCheckoutTool} from '../scripts/mcp-discovery.mjs';
const intentId='11111111-1111-4111-8111-111111111111';
const snap=data=>({result:{structuredContent:{success:true,data}}});
function fixture(overrides={}){
 let creates=0,prices=0,saved={},at=1000;
 const call=async(name,args)=>{
  if(name==='query-meal-detail')return snap({code:'a',name:'套餐'});
  if(name==='calculate-price'){prices++;return snap({price:prices>1&&overrides.changed?1200:1000,takeWayList:[{code:'take-in-store',title:'外带',subtitle:'店内自提'}]});}
  if(name==='query-order')return snap({orderStatusName:'待支付'});
  if(name==='create-order'){creates++;assert.equal(saved[intentId]?.state,'pending');if(overrides.fail)throw Error('timeout');return snap({orderId:'order-1',payUrl:'https://pay.mcd.cn/a'});}
 };
 const options={store:{storeCode:'1',storeName:'门店'},getMenu:()=>({meals:[{id:'a',name:'套餐'}]}),call,load:async()=>structuredClone(saved),save:async v=>{saved=structuredClone(v);},now:()=>at};
 return {service:createCheckout(options),options,counts:()=>({creates,prices}),saved:()=>saved,expire:()=>at=100000};
}
test('checkout rejects extra fields, delivery and unconfirmed mutation before network',async()=>{
 assert.throws(()=>validateCheckoutCall('calculate-price',{storeCode:'1',orderType:2,beType:2,items:[{productCode:'a',quantity:1}]}));
 assert.throws(()=>validateCheckoutCall('create-order',{storeCode:'1',orderType:1,beType:1,items:[{productCode:'a',quantity:1}],takeWayCode:'take-in-store',couponId:'x'}));
 await assert.rejects(callCheckoutTool('fake','create-order',{storeCode:'1',orderType:1,beType:1,items:[{productCode:'a',quantity:1}],takeWayCode:'take-in-store'},{fetchImpl:()=>assert.fail('must not connect')}),/ORDER_CONFIRMATION_REQUIRED/);
});
test('default combo includes selected and explicitly unselected modification keys',()=>{
 const item=buildItem({code:'a',rounds:[{id:1,minQuantity:1,maxQuantity:1,choices:[{code:'c',name:'汉堡',quantity:1,isDefault:1,modification:{items:[{values:[{code:'m',selectedQuantity:1,selectedKey:'0-1'},{code:'n',selectedQuantity:0,selectedKey:'0-1',unselectedKey:'0-0'}]}]}}]}]},'a',2).item;
 assert.equal(item.quantity,2);assert.equal(item.roundList[0].round,'1');
 assert.deepEqual(item.roundList[0].comboItemList[0].modification.values,[{code:'m',key:'0-1',quantity:1},{code:'n',key:'0-0',quantity:0}]);
 assert.throws(()=>buildItem({code:'a',rounds:[{id:1,choices:[]}]},'a',1));
});
test('real price is cents; unsafe or missing payment URLs never become links',()=>{
 assert.equal(normalizePrice(snap({price:3350,takeWayList:[{code:'a',title:'外带'}]})).amount,3350);
 assert.throws(()=>normalizePrice(snap({price:'3350',takeWayList:[]})));
 assert.equal(safePaymentLink('https://mcd.cn.evil.example/pay'),null);
 assert.equal(safePaymentLink('javascript:alert(1)'),null);
 assert.equal(safePaymentLink('https://user:password@mcd.cn/pay'),null);
 assert.throws(()=>normalizeOrder(snap({payUrl:'https://pay.mcd.cn'})));
});
test('quote is non-mutating; confirmed concurrent submission creates once and survives restart',async()=>{
 const f=fixture(),q=await f.service.quote({code:'a',quantity:1,intentId});
 assert.equal(f.counts().creates,0);
 const body={quoteId:q.quoteId,takeWayCode:'take-in-store',confirmed:true};
 const results=await Promise.all([f.service.submit(body),f.service.submit(body)]);
 assert.equal(results[0].orderId,'order-1');assert.equal(f.counts().creates,1);
 assert.equal((await f.service.submit(body)).orderId,'order-1');
 const restarted=createCheckout(f.options);
 await assert.rejects(restarted.quote({code:'a',quantity:1,intentId}),/已经提交/);
 assert.equal((await restarted.status(intentId)).receipt.orderId,'order-1');
});
test('changed price requires a second confirmation; forged takeway and expired quotes fail',async()=>{
 const f=fixture({changed:true}),q=await f.service.quote({code:'a',quantity:1,intentId});
 await assert.rejects(f.service.submit({quoteId:q.quoteId,takeWayCode:'forged',confirmed:true}),/取餐方式/);
 const changed=await f.service.submit({quoteId:q.quoteId,takeWayCode:'take-in-store',confirmed:true});
 assert.equal(changed.priceChanged,true);assert.equal(changed.quote.amount,1200);assert.equal(f.counts().creates,0);
 f.expire();await assert.rejects(f.service.submit({quoteId:q.quoteId,takeWayCode:'take-in-store',confirmed:true}),/过期/);
});
test('unknown create outcome is persisted and never retried, including after restart',async()=>{
 const f=fixture({fail:true}),q=await f.service.quote({code:'a',quantity:1,intentId});
 const body={quoteId:q.quoteId,takeWayCode:'take-in-store',confirmed:true};
 await assert.rejects(f.service.submit(body),/勿重复/);assert.equal(f.saved()[intentId].state,'unknown');
 await assert.rejects(f.service.submit(body),/勿重复/);assert.equal(f.counts().creates,1);
 await assert.rejects(createCheckout(f.options).quote({code:'a',quantity:1,intentId}),/勿重复/);
});
test('persistent pending crash state blocks new quote and no receipt claims payment',async()=>{
 const f=fixture();const s=createCheckout({...f.options,load:async()=>({[intentId]:{state:'pending'}})});
 await assert.rejects(s.quote({code:'a',quantity:1,intentId}),/勿重复/);
 assert.equal((await s.status(intentId)).state,'pending');
 const q=await f.service.quote({code:'a',quantity:1,intentId});
 const r=await f.service.submit({quoteId:q.quoteId,takeWayCode:'take-in-store',confirmed:true});
 assert.match(r.status,/完成支付/);assert.match((await f.service.status(intentId,{refresh:true})).receipt.status,/待支付/);
});
