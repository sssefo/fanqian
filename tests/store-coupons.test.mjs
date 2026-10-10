import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCoupons} from '../demo/coupon-service.mjs';
import {createCheckout} from '../demo/checkout-service.mjs';
import {createMenus} from '../demo/menu-service.mjs';
const snap=data=>({result:{structuredContent:{success:true,data}}});
const item={productCode:'meal-a',quantity:1};
const ways=[{code:'take-in-store',title:'外带',subtitle:'店内自提'}];
test('recommend minimum payable coupon, keep baseline on tie, exclude substitution',async()=>{
 const call=async(name,args)=>{
  if(name==='query-store-coupons')return snap([{couponId:'1',couponCode:'c1',name:'优惠一'},{couponId:'2',couponCode:'c2',name:'优惠二'},{couponId:'3',couponCode:'c3',name:'替换餐品券'}]);
  const i=args.items[0];return snap({price:i.couponId==='1'?800:i.couponId==='2'?650:100,takeWayList:ways,productList:[{productCode:i.couponId==='3'?'other':i.productCode,quantity:1}]});
 };
 const result=await compareCoupons({call,storeCode:'1',item,basePrice:{amount:1000,ways}});
 assert.equal(result.best.item.couponId,'2');assert.equal(result.best.amount,650);assert.equal(result.options.length,3);
 const tie=await compareCoupons({call:async n=>n==='query-store-coupons'?snap([{couponId:'1',couponCode:'c1'}]):snap({price:1000,takeWayList:ways,productList:[item]}),storeCode:'1',item,basePrice:{amount:1000,ways}});
 assert.equal(tie.best.key,'none');
});
test('empty or failed coupon list keeps usable no-coupon baseline',async()=>{
 const empty=await compareCoupons({call:async()=>snap([]),storeCode:'1',item,basePrice:{amount:1000,ways}});
 assert.equal(empty.options.length,1);assert.match(empty.note,/没有/);
 const failed=await compareCoupons({call:async()=>{throw Error();},storeCode:'1',item,basePrice:{amount:1000,ways}});
 assert.equal(failed.best.key,'none');assert.match(failed.note,/查询失败/);
});
test('manual no-coupon choice invalidates old quote; creation uses captured store and chosen plan',async()=>{
 let active='2',created;
 const svc=createCheckout({store:{storeCode:'1'},getStore:code=>({storeCode:code,storeName:code,address:'地址'}),getMenu:async code=>({meals:[{id:'meal-a',name:'套餐'}]}),
 call:async(name,args)=>{
  if(name==='query-meal-detail')return snap({code:'meal-a'});
  if(name==='query-store-coupons')return snap([{couponId:'1',couponCode:'c1',name:'优惠'}]);
  if(name==='calculate-price')return snap({price:args.items[0].couponId?800:1000,takeWayList:ways,productList:[item]});
  if(name==='create-order'){created=args;return snap({orderId:'order-1'});}
 }});
 const q=await svc.quote({storeCode:active,code:'meal-a',quantity:1,intentId:'11111111-1111-4111-8111-111111111111'});
 assert.equal(q.amount,800);assert.equal(q.store.code,'2');active='3';
 const manual=await svc.choose({quoteId:q.quoteId,couponKey:'none'});assert.equal(manual.amount,1000);
 await assert.rejects(svc.submit({quoteId:q.quoteId,takeWayCode:'take-in-store',confirmed:true}),/最新确认页/);
 await svc.submit({quoteId:manual.quoteId,takeWayCode:'take-in-store',confirmed:true});
 assert.equal(created.storeCode,'2');assert.equal(created.items[0].couponId,undefined);
});
test('coupon invalidation falls back to baseline with second confirmation and no create',async()=>{
 let invalid=false,creates=0;
 const svc=createCheckout({store:{storeCode:'1'},getMenu:()=>({meals:[{id:'meal-a',name:'套餐'}]}),call:async(name,args)=>{
  if(name==='query-meal-detail')return snap({code:'meal-a'});
  if(name==='query-store-coupons')return snap([{couponId:'1',couponCode:'c1'}]);
  if(name==='calculate-price'){if(invalid&&args.items[0].couponId)throw Error();return snap({price:args.items[0].couponId?800:1000,takeWayList:ways,productList:[item]});}
  if(name==='create-order'){creates++;return snap({orderId:'a'});}
 }});
 const q=await svc.quote({code:'meal-a',quantity:1,intentId:'11111111-1111-4111-8111-111111111111'});invalid=true;
 const changed=await svc.submit({quoteId:q.quoteId,takeWayCode:'take-in-store',confirmed:true});
 assert.equal(changed.priceChanged,true);assert.equal(changed.quote.couponKey,'none');assert.equal(changed.quote.amount,1000);assert.equal(creates,0);
});
test('menus are isolated by store and only discovered stores can be queried',async()=>{
 const old={store:{code:'1'},meals:[{id:'old',name:'旧套餐'}]};
 const registry=createMenus({initialStores:[{storeCode:'1',storeName:'店一',address:'地址一'}],initialMenu:old,
 call:async(name,args)=>name==='query-nearby-stores'?snap([{storeCode:'2',storeName:'店二',address:'地址二'}]):snap({categories:[{name:'单人餐',meals:[{code:'new'}]}],meals:{new:{name:'新套餐',currentPrice:30}}})
 });
 await assert.rejects(registry.menu('3'),/搜索/);
 await registry.search({city:'城市',keyword:'商场'});const next=await registry.menu('2');
 assert.equal(next.store.code,'2');assert.equal(next.meals[0].id,'new');assert.equal((await registry.menu('1')).meals[0].id,'old');
});

test('comparison cap is explicit and cannot claim all-coupon optimum',async()=>{
 let trials=0;
 const result=await compareCoupons({call:async name=>{if(name==='query-store-coupons')return snap(Array.from({length:25},(_,i)=>({couponId:String(i),couponCode:'c'+i})));trials++;return snap({price:900,takeWayList:ways,productList:[item]});},storeCode:'1',item,basePrice:{amount:1000,ways}});
 assert.equal(trials,20);assert.equal(result.complete,false);assert.match(result.note,/最多20张/);
});