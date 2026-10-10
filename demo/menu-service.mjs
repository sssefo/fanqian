import {CheckoutError,business} from './checkout-model.mjs';
import {normalizeMenu} from './menu-adapter.mjs';
export function publicStore(s){
 if(!s||typeof s.storeCode!=='string'||!/^\d{1,12}$/.test(s.storeCode)||typeof s.storeName!=='string'||typeof s.address!=='string')throw new CheckoutError('门店数据格式无法识别。',502);
 return {storeCode:s.storeCode,storeName:s.storeName.slice(0,120),address:s.address.slice(0,240)};
}
export function createMenus({initialStores,initialMenu,call,persist=async()=>{},now=Date.now}){
 const stores=new Map(initialStores.map(s=>{const p=publicStore(s);return [p.storeCode,p];}));
 const menus=new Map([[initialMenu.store.code,initialMenu]]),tasks=new Map(),refreshed=new Map();
 function getStore(code){const s=stores.get(code);if(!s)throw new CheckoutError('请先搜索并选择门店。');return s;}
 return {getStore,
  async search({city,keyword}){
   if(typeof city!=='string'||!city.trim()||city.length>80||typeof keyword!=='string'||!keyword.trim()||keyword.length>80)throw new CheckoutError('请填写城市和附近地点。');
   const rows=business(await call('query-nearby-stores',{city:city.trim(),keyword:keyword.trim(),searchType:2,beType:1}));
   if(!Array.isArray(rows))throw new CheckoutError('门店列表格式无法识别。',502);
   const clean=rows.map(publicStore);for(const s of clean)stores.set(s.storeCode,s);
   await persist([...stores.values()]);return {stores:clean,city:city.trim(),keyword:keyword.trim()};
  },
  async menu(code,{refresh=false}={}){
   const s=getStore(code);
   if(!refresh&&menus.has(code))return menus.get(code);
   if(refresh&&now()-(refreshed.get(code)||0)<15000)throw new CheckoutError('请稍后再更新这家店的菜单。',429);
   if(!tasks.has(code)){
    if(refresh)refreshed.set(code,now());
    tasks.set(code,(async()=>{
     const snapshot=await call('query-meals',{storeCode:code,orderType:1,beType:1});
     const result=normalizeMenu(snapshot,s);menus.set(code,result);return result;
    })().finally(()=>tasks.delete(code)));
   }
   return tasks.get(code);
  }
 };
}
