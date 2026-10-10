export function initCheckout(getAccepted){
 const $=id=>document.getElementById(id);
 let quote=null,accepted,revision=0,submitting=false,blocked=false,choosing=false,pricing=false;
 const fmt=n=>'¥'+(n/100).toFixed(2);
 async function request(path,body){
  const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'请求未完成');return data;
 }
 function renderQuote(q){
  quote=q;blocked=false;$('checkout-inputs').hidden=false;$('checkout-receipt').hidden=true;
  $('checkout-defaults').replaceChildren();
  for(const d of q.defaults){const p=document.createElement('p');p.textContent=d.name+' × '+d.quantity;$('checkout-defaults').append(p);}
  $('checkout-store').textContent=q.store.name+' · '+q.store.address;
  $('checkout-way').replaceChildren();for(const w of q.ways){const o=document.createElement('option');o.value=w.code;o.textContent=w.title+' · '+w.subtitle;$('checkout-way').append(o);}
  $('checkout-total').textContent=fmt(q.amount);
  $('checkout-expiry').textContent='默认规格与搭配 · 价格保留90秒，提交前再次核价';
  $('checkout-coupons').replaceChildren();
  for(const c of q.coupons||[{key:'none',name:'不用券',amount:q.amount,saving:0}]){
   const o=document.createElement('option');o.value=c.key;o.textContent=(c.recommended?'推荐 · ':'')+c.name+' · '+fmt(c.amount)+(c.saving>0?'（省'+fmt(c.saving)+'）':'');$('checkout-coupons').append(o);
  }
  $('checkout-coupons').value=q.couponKey||'none';$('checkout-coupon-note').textContent=q.couponNote||'';
  $('checkout-confirm').checked=false;update();
 }
 function update(){$('checkout-submit').disabled=!quote||blocked||submitting||choosing||!$('checkout-confirm').checked||Date.now()>quote.expiresAt;$('checkout-close').disabled=submitting||choosing;$('checkout-coupons').disabled=!quote||submitting||blocked||choosing||pricing;$('checkout-requote').disabled=submitting||blocked||choosing||pricing;$('checkout-quantity').disabled=submitting||choosing||pricing;$('checkout-way').disabled=submitting;}
 function receipt(r){
  blocked=true;quote=null;$('checkout-inputs').hidden=true;$('checkout-receipt').hidden=false;
  $('checkout-order-id').textContent='订单号：'+r.orderId;$('checkout-order-status').textContent=r.status;
  $('checkout-pay').hidden=!r.paymentUrl;if(r.paymentUrl)$('checkout-pay').href=r.paymentUrl;
  $('checkout-message').textContent='订单已创建。请在麦当劳完成支付，用餐后再记一笔。';update();
 }
 async function status(refresh=false){
  const rev=revision;
  const result=await request('/api/checkout/status?intentId='+encodeURIComponent(accepted.drawId)+(refresh?'&refresh=1':''));
  if(rev!==revision)return true;
  if(result.state==='created'){receipt(result.receipt);return true;}
  if(['pending','unknown'].includes(result.state)){
   blocked=true;quote=null;$('checkout-message').textContent='上次提交结果尚不明确。请在麦当劳 App 核对，勿重复提交。';update();return true;
  }return false;
 }
 async function price(){
  if(pricing)return;pricing=true;const rev=++revision;quote=null;$('checkout-total').textContent='—';$('checkout-confirm').checked=false;update();$('checkout-message').textContent='正在读取实时规格、价格与可用优惠…';
  $('checkout-requote').disabled=true;
  try{
   const q=await request('/api/checkout/quote',{code:accepted.meal.id,quantity:Number($('checkout-quantity').value),intentId:accepted.drawId,storeCode:accepted.store?.code||'1980064'});
   if(rev!==revision)return;renderQuote(q);$('checkout-message').textContent='请核对默认搭配、外带自取方式和金额。';
  }catch(e){if(rev===revision)$('checkout-message').textContent=e.message;}
  finally{if(rev===revision){pricing=false;update();}}
 }
 async function open(){
  accepted=getAccepted();if(!accepted)return;
  ++revision;quote=null;blocked=false;submitting=false;pricing=false;
  $('checkout-meal').textContent=accepted.meal.name;$('checkout-quantity').value=1;$('checkout-store').textContent=accepted.store?(accepted.store.name+' · '+(accepted.store.address||'')):'选定时的门店：呼和浩特新华东街餐厅';
  $('checkout-defaults').replaceChildren();$('checkout-inputs').hidden=false;$('checkout-receipt').hidden=true;$('checkout-total').textContent='—';
  $('checkout-confirm').checked=false;$('checkout-coupons').replaceChildren();$('checkout-coupon-note').textContent='';$('checkout-message').textContent='正在检查已有订单…';update();
  if(!$('checkout-dialog').open)$('checkout-dialog').showModal();
  try{if(!await status())await price();}catch(e){blocked=true;$('checkout-message').textContent=e.message;update();}
 }
 $('checkout-close').onclick=()=>{if(!submitting&&!choosing){pricing=false;++revision;$('checkout-dialog').close();}};
 $('checkout-dialog').addEventListener('cancel',e=>{if(submitting||choosing)e.preventDefault();else {pricing=false;++revision;}});
 $('checkout-coupons').onchange=async()=>{
  if(!quote||submitting||choosing)return;
  const rev=++revision,id=quote.quoteId,key=$('checkout-coupons').value;choosing=true;$('checkout-confirm').checked=false;update();$('checkout-message').textContent='正在核算所选优惠…';
  try{const q=await request('/api/checkout/coupon',{quoteId:id,couponKey:key});if(rev!==revision)return;renderQuote(q);$('checkout-message').textContent='优惠方案已更新，请重新确认金额。';}
  catch(e){if(rev===revision){quote=null;$('checkout-message').textContent=e.message;}}
  finally{choosing=false;update();}
 };
 $('checkout-confirm').onchange=update;$('checkout-requote').onclick=price;
 $('checkout-quantity').oninput=()=>{++revision;quote=null;$('checkout-total').textContent='—';$('checkout-message').textContent='数量已变化，请重新计算价格。';update();};
 $('checkout-submit').onclick=async()=>{
  if(!quote||submitting||!$('checkout-confirm').checked)return;
  submitting=true;update();$('checkout-message').textContent='正在核价并提交，请勿重复点击…';
  try{
   const result=await request('/api/checkout/submit',{quoteId:quote.quoteId,takeWayCode:$('checkout-way').value,confirmed:true});
   if(result.priceChanged){renderQuote(result.quote);$('checkout-message').textContent='价格或取餐方式发生变化，请核对后再次确认。';}
   else receipt(result);
  }catch(e){
   quote=null;$('checkout-message').textContent=e.message;
   try{await status();}catch{blocked=true;}
  }finally{submitting=false;update();}
 };
 $('checkout-status').onclick=async()=>{ $('checkout-status').disabled=true;try{await status(true);}catch(e){$('checkout-message').textContent=e.message;}finally{$('checkout-status').disabled=false;} };
 setInterval(()=>{if($('checkout-dialog').open)update();},1000);
 return open;
}
