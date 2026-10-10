export function initStores({select,getSelected}){
 const $=id=>document.getElementById(id);let busy=false;
 function message(text){$('store-search-message').textContent=text;}
 $('change-store').onclick=()=>{$('store-search-dialog').showModal();};
 $('store-search-form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;busy=true;$('store-search-button').disabled=true;message('正在查询这个地点附近的门店…');$('store-search-results').replaceChildren();
  try{
   const response=await fetch('/api/stores/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({city:$('store-city').value,keyword:$('store-keyword').value})});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'查询失败');
   message(data.stores.length?'选择你要去的门店，餐品和价格会按门店更新。':'没有找到门店，请换一个地点。');
   for(const s of data.stores){
    const b=document.createElement('button');b.className='store-option';
    const title=document.createElement('b'),address=document.createElement('span');title.textContent=s.storeName+(getSelected()===s.storeCode?' · 当前':'');address.textContent=s.address;b.append(title,address);
    b.onclick=async()=>{
     if(busy)return;busy=true;document.querySelectorAll('.store-option').forEach(x=>x.disabled=true);message('正在加载这家店的菜单…');
     try{await select(s.storeCode);$('store-search-dialog').close();}catch(error){message(error.message);}
     finally{busy=false;document.querySelectorAll('.store-option').forEach(x=>x.disabled=false);}
    };
    $('store-search-results').append(b);
   }
  }catch(error){message(error.message);}finally{busy=false;$('store-search-button').disabled=false;}
 };
}
