import { DiscoveryError } from './mcp-discovery.mjs';
const bad=()=>{throw new DiscoveryError('INVALID_ARGUMENTS');};
const id=v=>typeof v==='string' && /^[A-Za-z0-9_.-]{1,128}$/.test(v);
function exact(o,keys){if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!keys.includes(k)))bad();}
function mod(o){exact(o,['values']);if(!Array.isArray(o.values)||o.values.length>100)bad();for(const v of o.values){exact(v,['code','key','quantity']);if(!id(v.code)||!id(v.key)||!Number.isInteger(v.quantity)||v.quantity<0||v.quantity>20)bad();}}
export function validateCheckoutCall(name,args){
 if(!['calculate-price','create-order','query-order','query-store-coupons'].includes(name))throw new DiscoveryError('TOOL_NOT_ALLOWED');
 if(name==='query-store-coupons'){exact(args,['storeCode','orderType','beType']);if(!id(args.storeCode)||args.orderType!==1||args.beType!==1)bad();return structuredClone(args);}
 if(name==='query-order'){exact(args,['orderId']);if(!id(args.orderId))bad();return structuredClone(args);}
 exact(args,['storeCode','orderType','beType','items',...(name==='create-order'?['takeWayCode']:[])]);
 if(!id(args.storeCode)||args.orderType!==1||args.beType!==1||!Array.isArray(args.items)||args.items.length!==1)bad();
 if(name==='create-order'&&!id(args.takeWayCode))bad();
 for(const i of args.items){
  exact(i,['productCode','quantity','roundList','modification','couponId','couponCode']);
  if(!id(i.productCode)||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>10)bad();
  if((i.couponId!==undefined||i.couponCode!==undefined)&&(!id(i.couponId)||!id(i.couponCode)))bad();
  if(i.modification)mod(i.modification);
  if(i.roundList){if(!Array.isArray(i.roundList)||i.roundList.length>20)bad();for(const r of i.roundList){
   exact(r,['round','comboItemList']);if(!id(r.round)||!Array.isArray(r.comboItemList)||!r.comboItemList.length)bad();
   for(const c of r.comboItemList){exact(c,['code','quantity','modification']);if(!id(c.code)||!Number.isInteger(c.quantity)||c.quantity<1||c.quantity>20)bad();if(c.modification)mod(c.modification);}
  }}
 }
 return structuredClone(args);
}
