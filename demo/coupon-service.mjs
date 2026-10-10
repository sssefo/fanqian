import {business,normalizePrice,CheckoutError} from './checkout-model.mjs';
const valid=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(v);
export function couponCandidates(snapshot){
 const data=business(snapshot);
 const rows=Array.isArray(data)?data:data.coupons||data.couponList;
 if(!Array.isArray(rows))throw new CheckoutError('优惠券格式暂不能识别。',502);
 const seen=new Set(),result=[];
 for(const c of rows){
  if(!valid(c.couponId)||!valid(c.couponCode))continue;
  const unique=c.couponId+':'+c.couponCode;if(seen.has(unique))continue;seen.add(unique);
  result.push({couponId:c.couponId,couponCode:c.couponCode,name:String(c.couponName||c.name||'可用优惠券').slice(0,80)});
 }
 return {candidates:result.slice(0,20),complete:rows.length===result.length&&result.length<=20};
}
export function checkSameProducts(snapshot,item){
 const rows=business(snapshot).productList;
 if(!Array.isArray(rows)||rows.length!==1||rows[0].productCode!==item.productCode||rows[0].quantity!==item.quantity)throw new CheckoutError('该券不能确认适用于当前餐品与数量。');
 return normalizePrice(snapshot);
}
export async function compareCoupons({call,storeCode,item,basePrice}){
 const base={key:'none',name:'不用券',item:structuredClone(item),...basePrice};
 const options=[base];let note='',complete=true;
 try{
  const result=couponCandidates(await call('query-store-coupons',{storeCode,orderType:1,beType:1}));
  complete=result.complete;
  if(!result.candidates.length)note=complete?'当前门店没有可试算的已持有优惠券。':'部分券格式暂不支持，当前按不用券计算。';
  // Small batches keep request volume bounded; a failing coupon does not invalidate the baseline.
  for(let offset=0;offset<result.candidates.length;offset+=3){
   const batch=await Promise.all(result.candidates.slice(offset,offset+3).map(async(c,i)=>{
    const chosen={...structuredClone(item),couponId:c.couponId,couponCode:c.couponCode};
    try{
     const snapshot=await call('calculate-price',{storeCode,orderType:1,beType:1,items:[chosen]});
     const price=checkSameProducts(snapshot,chosen);
     if(price.amount>basePrice.amount)return null;
     return {key:'coupon-'+(offset+i),name:c.name,item:chosen,...price};
    }catch{return null;}
   }));
   options.push(...batch.filter(Boolean));
  }
  if(!note)note=complete?'已比较当前可试算的单券方案，不叠券。':'部分券不能完整比较，推荐仅覆盖已验证方案（每次最多20张）。';
 }catch{complete=false;note='优惠券查询失败，仅按不用券计算，可重新算价再试。';}
 // Equal amounts prefer no coupon, preserving the coupon for another order.
 const best=options.reduce((a,b)=>b.amount<a.amount?b:a,base);
 return {options,best,note,complete};
}
