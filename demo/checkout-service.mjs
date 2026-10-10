import {compareCoupons,checkSameProducts} from './coupon-service.mjs';
import {randomUUID} from 'node:crypto';
import {CheckoutError,business,buildItem,normalizePrice,normalizeOrder,normalizeStatus} from './checkout-model.mjs';
export function createCheckout({store,getStore=code=>{if(code!==store.storeCode)throw new CheckoutError('请先搜索并选择门店。');return store;},getMenu,call,load=async()=>({}),save=async()=>{},now=Date.now}){
 const quotes=new Map(),jobs=new Map(),activeQuotes=new Map(),selections=new Set(),quoteSequence=new Map();let journal;let loading;
 async function ready(){loading ||= load().then(v=>{journal=v;});await loading;}
 const args=(item,selectedStore)=>({storeCode:selectedStore.storeCode,orderType:1,beType:1,items:[item]});
 function publicQuote(q){return {quoteId:q.id,intentId:q.intentId,meal:q.meal,quantity:q.item.quantity,defaults:q.description,store:{code:q.store.storeCode,name:q.store.storeName,address:q.store.address},amount:q.amount,ways:q.ways,expiresAt:q.expiresAt,couponKey:q.couponKey,recommendedKey:q.recommendedKey,couponNote:q.couponNote,coupons:q.options.map(o=>({key:o.key,name:o.name,amount:o.amount,saving:Math.max(0,q.baseAmount-o.amount),recommended:o.key===q.recommendedKey}))};}
 return {
  async quote({code,quantity,intentId,storeCode}){
   await ready();
   if(typeof intentId!=='string'||! /^[0-9a-f-]{36}$/i.test(intentId))throw new CheckoutError('请先选定餐品。');
   if(selections.has(intentId)||jobs.has(intentId)||(journal[intentId]&&journal[intentId].state!=='rejected'))throw new CheckoutError('这次选择已经提交过订单，请查看已有订单，勿重复提交。',409);
   const sequence=(quoteSequence.get(intentId)||0)+1;quoteSequence.set(intentId,sequence);
   const selectedStore=getStore(storeCode||store.storeCode);
   const selectedMenu=await getMenu(selectedStore.storeCode);
   const meal=selectedMenu.meals.find(m=>m.id===code);if(!meal)throw new CheckoutError('餐品已不在当前菜单，请重新抽取。');
   if(quotes.size>100)for(const[k,q]of quotes)if(q.expiresAt<now())quotes.delete(k);
   const detail=business(await call('query-meal-detail',{storeCode:selectedStore.storeCode,code,orderType:1,beType:1}));
   const {item,description}=buildItem(detail,code,quantity);
   const price=normalizePrice(await call('calculate-price',args(item,selectedStore)));
   const comparison=await compareCoupons({call,storeCode:selectedStore.storeCode,item,basePrice:price});
   const q={id:randomUUID(),intentId,meal:{id:meal.id,name:meal.name,image:meal.image},store:selectedStore,item:comparison.best.item,baseItem:item,description,...comparison.best,couponKey:comparison.best.key,recommendedKey:comparison.best.key,couponNote:comparison.note,options:comparison.options,baseAmount:price.amount,expiresAt:now()+90000};
   if(quoteSequence.get(intentId)!==sequence)throw new CheckoutError('已有更新的报价请求，请等待最新结果。',409);
   quotes.set(q.id,q);activeQuotes.set(q.intentId,q.id);return publicQuote(q);
  },
  async choose({quoteId,couponKey}){
   const q=quotes.get(quoteId);if(!q||q.expiresAt<now())throw new CheckoutError('价格已过期，请重新算价。',409);
   await ready();if(jobs.has(q.intentId)||(journal[q.intentId]&&journal[q.intentId].state!=='rejected'))throw new CheckoutError('此选择已提交，不能更换券。',409);
   if(selections.has(q.intentId)||activeQuotes.get(q.intentId)!==q.id)throw new CheckoutError('优惠方案正在更新，请使用最新结果。',409);
   const option=q.options.find(o=>o.key===couponKey);if(!option)throw new CheckoutError('请选择当前确认页提供的优惠方案。');
   selections.add(q.intentId);try{
   const snapshot=await call('calculate-price',args(option.item,q.store));
   const price=couponKey==='none'?normalizePrice(snapshot):checkSameProducts(snapshot,option.item);
   const next={...structuredClone(q),...price,id:randomUUID(),item:option.item,couponKey,expiresAt:now()+90000};
   Object.assign(next.options.find(o=>o.key===couponKey),price);
   quotes.set(next.id,next);activeQuotes.set(next.intentId,next.id);
   return publicQuote(next);
   }finally{selections.delete(q.intentId);}
  },
  async submit({quoteId,takeWayCode,confirmed}){
   await ready();if(confirmed!==true)throw new CheckoutError('请核对订单并明确确认提交。');
   const q=quotes.get(quoteId);if(!q)throw new CheckoutError('确认页已失效，请重新算价。',409);
   if(selections.has(q.intentId))throw new CheckoutError('优惠方案正在更新，请稍后确认。',409);
   if(jobs.has(q.intentId))return jobs.get(q.intentId);
   if(journal[q.intentId]?.state==='created')return journal[q.intentId].receipt;
   if(journal[q.intentId]&&journal[q.intentId].state!=='rejected')throw new CheckoutError('上次提交结果尚不明确，请到麦当劳 App 核对，勿重复提交。',409);
   if(activeQuotes.get(q.intentId)!==q.id)throw new CheckoutError('优惠方案已更新，请使用最新确认页提交。',409);
   if(q.expiresAt<now())throw new CheckoutError('价格已过期，请重新算价后确认。',409);
   if(!q.ways.some(w=>w.code===takeWayCode))throw new CheckoutError('请选择接口返回的外带取餐方式。');
   const job=(async()=>{
    let current,couponChanged=false;
    try{
     const snapshot=await call('calculate-price',args(q.item,q.store));
     current=q.couponKey==='none'?normalizePrice(snapshot):checkSameProducts(snapshot,q.item);
    }catch(e){
     if(q.couponKey==='none')throw e;
     current=normalizePrice(await call('calculate-price',args(q.baseItem,q.store)));
     q.item=q.baseItem;q.couponKey='none';q.recommendedKey='none';q.options=q.options.filter(o=>o.key==='none');q.couponNote='优惠券暂不可用，已改为不用券，请重新确认。';couponChanged=true;
    }
    if(couponChanged||current.amount!==q.amount||!current.ways.some(w=>w.code===takeWayCode)){
     Object.assign(q,current,{expiresAt:now()+90000});return {priceChanged:true,quote:publicQuote(q)};
    }
    journal[q.intentId]={state:'pending',checkedAt:new Date(now()).toISOString()};
    await save(journal); // Persist before the irreversible request; do not retry unknown outcomes.
    let snapshot;
    try{snapshot=await call('create-order',{...args(q.item,q.store),takeWayCode},{confirmed:true});}
    catch{journal[q.intentId].state='unknown';await save(journal);throw new CheckoutError('提交结果暂不明确，请到麦当劳 App 核对订单，勿重复提交。',502);}
    if(snapshot?.result?.structuredContent?.success===false){journal[q.intentId].state='rejected';await save(journal);throw new CheckoutError('麦当劳未接受此次订单，请核对营业时间、餐品或账号后重新算价。',502);}
    let receipt;
    try{receipt=normalizeOrder(snapshot);}catch(e){journal[q.intentId].state='unknown';await save(journal);throw e;}
    receipt={...receipt,intentId:q.intentId,meal:q.meal,quantity:q.item.quantity,amount:q.amount,store:{code:q.store.storeCode,name:q.store.storeName,address:q.store.address},couponName:q.options.find(o=>o.key===q.couponKey)?.name,takeWay:q.ways.find(w=>w.code===takeWayCode).title};
    journal[q.intentId]={state:'created',receipt,checkedAt:new Date(now()).toISOString()};await save(journal);return receipt;
   })();
   jobs.set(q.intentId,job);
   try{return await job;}finally{jobs.delete(q.intentId);}
  },
  async status(intentId,{refresh=false}={}){
   await ready();const record=journal[intentId];
   if(!record)return {state:'none'};
   if(record.state==='created'){
    const receipt={...record.receipt};
    if(refresh)Object.assign(receipt,normalizeStatus(await call('query-order',{orderId:receipt.orderId})));
    return {state:'created',receipt};
   }
   return {state:record.state};
  }
 };
}
