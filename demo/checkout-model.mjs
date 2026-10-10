export class CheckoutError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export function business(snapshot) {
 const b=snapshot?.result?.structuredContent;
 if(b?.success===false && b.code===60003) throw new CheckoutError('这家门店暂停营业，请换一家门店并重新抽取。',409);
 if(b?.success!==true || !b.data) throw new CheckoutError('门店暂不能完成此次操作，请检查营业时间、餐品供应或账号授权。',502);
 return b.data;
}
function modifications(m){
 if(!m?.items?.length)return;
 const values=[];
 for(const group of m.items)for(const v of group.values||[]){
  if(!Number.isInteger(v.selectedQuantity)||v.selectedQuantity<0)throw new CheckoutError('该餐品没有明确的默认规格，请在麦当劳 App 中点餐。');
  if(v.selectedQuantity>0)values.push({code:v.code,key:v.selectedKey,quantity:v.selectedQuantity});
  else if(v.unselectedKey)values.push({code:v.code,key:v.unselectedKey,quantity:0});
 }
 return values.length?{values}:undefined;
}
export function buildItem(detail,code,quantity){
 if(detail.code!==code)throw new CheckoutError('餐品详情不匹配，请重新选择。');
 if(!Number.isInteger(quantity)||quantity<1||quantity>10)throw new CheckoutError('数量请填写1至10份。');
 const item={productCode:code,quantity},description=[];
 const modification=modifications(detail.modification);
 if(modification)item.modification=modification;
 if(detail.rounds?.length){
  item.roundList=detail.rounds.map(round=>{
   const choices=(round.choices||[]).filter(c=>c.isDefault===1&&c.quantity>0);
   if(!choices.length)throw new CheckoutError('该餐品需要额外选规格，第一版请在麦当劳 App 中点餐。');
   const sum=choices.reduce((a,c)=>a+c.quantity,0);
   if((Number.isFinite(round.minQuantity)&&sum<round.minQuantity)||(Number.isFinite(round.maxQuantity)&&round.maxQuantity>=0&&sum>round.maxQuantity))throw new CheckoutError('套餐默认搭配不完整，请在麦当劳 App 中点餐。');
   return {round:String(round.id),comboItemList:choices.map(c=>{
    if(!Number.isInteger(c.quantity))throw new CheckoutError('默认规格无效。');
    description.push({name:c.name,quantity:c.quantity});
    const result={code:c.code,quantity:c.quantity};const mod=modifications(c.modification);if(mod)result.modification=mod;return result;
   })};
  });
 }
 return {item,description};
}

export function normalizePrice(snapshot){
 const d=business(snapshot);
 if(!Number.isSafeInteger(d.price)||d.price<0||!Array.isArray(d.takeWayList))throw new CheckoutError('实时价格格式无法确认，暂不能提交订单。',502);
 const ways=d.takeWayList.filter(w=>typeof w.code==='string'&&/外带|自提/.test(w.title+' '+w.subtitle)).map(w=>({code:w.code,title:w.title,subtitle:w.subtitle||''}));
 if(!ways.length)throw new CheckoutError('当前门店未提供外带自取，请稍后再试。');
 return {amount:d.price,originalAmount:Number.isSafeInteger(d.originalPrice)?d.originalPrice:d.price,ways};
}
export function safePaymentLink(value){
 try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='mcd.cn'||u.hostname.endsWith('.mcd.cn')||u.hostname==='mcd.com.cn'||u.hostname.endsWith('.mcd.com.cn')))return u.href;}catch{}
 return null;
}
export function normalizeOrder(snapshot){
 const d=business(snapshot);
 const orderId=d.orderId||d.order?.orderId;
 if(typeof orderId!=='string'||!/^[A-Za-z0-9_.-]{1,128}$/.test(orderId))throw new CheckoutError('订单可能已创建，但返回的订单号无法识别。请在麦当劳 App 中核对，勿重复提交。',502);
 const paymentUrl=safePaymentLink(d.payUrl||d.paymentUrl||d.payLink||d.paymentLink||d.payInfo?.payUrl||d.payment?.url);
 return {orderId,paymentUrl,status:'订单已创建，请前往麦当劳完成支付'};
}
export function normalizeStatus(snapshot){
 const d=business(snapshot);
 const text=d.orderStatusDesc||d.orderStatusName||d.statusName;
 return {status:typeof text==='string'?text.slice(0,100):'已查询订单，请在麦当劳 App 中确认支付与取餐状态'};
}
