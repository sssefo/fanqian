export function normalizeMenu(snapshot, store) {
 const body=snapshot?.result?.structuredContent;
 if(body?.success!==true || !body.data?.categories || !body.data?.meals) throw new Error('菜单业务响应无效');
 const seen=new Set(), meals=[];
 for(const category of body.data.categories) for(const entry of category.meals||[]) {
  if(seen.has(entry.code)) continue;
  const m=body.data.meals[entry.code];
  if(!m || typeof m.name!=='string') continue;
  if(/双人|多人|分享|亲子|儿童|学生|会员|随心|精选|周边|乐园|泡泡机|按摩|痒痒挠|百宝袋/.test(m.name)) continue;
  if(m.canWithOrder || m.withOrder || (m.discountType && m.discountType!=='促销优惠')) continue;
  let group;
  if(/三件套|套餐/.test(m.name) && /单人餐|鸡肉汉堡|牛鱼肉堡|安格斯|炸鸡|大卡套餐/.test(category.name)) group='meal';
  else if(!/件套|套餐|拼盘|拼|四宫格|双全盒|十翅|酱$/.test(m.name)) {
   if(/麦旋风|圆筒|圣代|派|阿芙佳朵/.test(m.name)) group='snack';
   else if(/饮品|麦咖啡/.test(category.name)) group='drink';
   else if(/小食甜品|炸鸡|蘸酱炸鸡/.test(category.name) && /薯|鸡|翅|芝士条/.test(m.name)) group='snack';
  }
  if(!group) continue;
  const price=Number(m.currentPrice);if(!Number.isFinite(price)||price<=0)continue;
  const image=typeof m.image==='string' && /^https:\/\/menu-img\.mcd\.cn\//.test(m.image)?m.image:'';
  seen.add(entry.code);
  meals.push({id:entry.code,name:m.name,image,price,group,kind:{meal:'单人套餐',snack:'小吃甜品',drink:'饮品咖啡'}[group]});
 }
 if(!meals.length)throw new Error('当前没有符合条件的餐品');
 return {store:{code:store.storeCode,name:store.storeName,address:store.address},checkedAt:snapshot.checkedAt,source:'麦当劳 MCP · 到店菜单',menuCount:Object.keys(body.data.meals).length,meals};
}

export function normalizeDetail(snapshot) {
  const body = snapshot?.result?.structuredContent;
  if (body?.success !== true || !body.data) throw new Error('餐品详情不可用');
  const d = body.data;
  return { name: d.name, supportModify: !!d.supportModify,
    defaults: (d.rounds || []).flatMap(round => (round.choices || [])
      .filter(c => c.isDefault === 1).map(c => ({
        name: c.name, quantity: c.quantity || 1, supportModify: !!c.supportModify,
      }))),
  };
}
