import test from 'node:test';
import assert from 'node:assert/strict';
import {today,range,summarize,drawMeal,upsertRecord,validateState,defaultState} from '../demo/dist/domain.mjs';
import {normalizeMenu,normalizeDetail} from '../demo/menu-adapter.mjs';
const now=Date.parse('2026-10-09T15:00:00Z');
const draft={id:'a',name:' 面条 ',date:'2026-10-09',slot:'lunch',sourceDrawId:'draw1'};
test('Beijing midnight and natural week/month boundaries',()=>{
 assert.equal(today(Date.parse('2026-10-09T16:00:00Z')),'2026-10-10');
 assert.deepEqual(range('week',Date.parse('2026-03-01T04:00:00Z')),{start:'2026-02-23',end:'2026-03-01'});
 assert.deepEqual(range('month',Date.parse('2024-02-29T04:00:00Z')),{start:'2024-02-01',end:'2024-02-29'});
});
test('selection is separate from actual records and recap excludes other weeks',()=>{
 const s=defaultState();s.lastAccepted={drawId:'draw1',meal:{name:'面条'},rarity:'blue'};
 assert.equal(summarize(s.records,'week',now).count,0);
 const rows=[{...draft,name:'面条'},{...draft,id:'b',date:'2026-10-08',slot:'dinner',name:'面条'},{...draft,id:'c',date:'2026-10-01',name:'米饭'}];
 assert.equal(summarize(rows,'week',now).count,2);
 assert.deepEqual(summarize(rows,'week',now).top.map(x=>[x.name,x.count]),[['面条',2]]);
 assert.equal(summarize(rows,'month',now).count,3);
});
test('source draw dedup, occupied slot replacement and date validation',()=>{
 const rows=upsertRecord([],draft,now).records;assert.equal(rows[0].name,'面条');
 assert.equal(upsertRecord(rows,{...draft,id:'b',slot:'dinner'},now).existing.id,'a');
 assert.equal(upsertRecord(rows,{...draft,id:'b',sourceDrawId:null},now).conflict.id,'a');
 assert.equal(upsertRecord(rows,{...draft,id:'b',sourceDrawId:null},now,true).records.length,1);
 assert.throws(()=>upsertRecord([],{...draft,date:'2026-02-30'},now));
 assert.throws(()=>upsertRecord([],{...draft,date:'2026-10-10'},now));
});
test('recent releases oldest first while disabled meals stay excluded',()=>{
 const meals=['a','b','c'].map(id=>({id,name:id}));let v=[0,.99];
 const r=drawMeal(meals,['c'],['a','b'],()=>v.shift());assert.equal(r.meal.id,'a');assert.equal(r.rarity,'gold');
 v=[.99,0];assert.equal(drawMeal(meals,[],[],()=>v.shift()).rarity,'blue');
 assert.throws(()=>drawMeal(meals,['a','b','c'],[]));
});
test('corrupt storage and duplicate slots are rejected',()=>{
 assert.throws(()=>validateState({...defaultState(),records:[draft,{...draft,id:'b'}]}));
 assert.throws(()=>validateState({...defaultState(),lastAccepted:{}}));
});
test('menu filters membership and non-meal items and limits image host',()=>{
 const snapshot={checkedAt:'2026-10-09T00:00:00Z',result:{structuredContent:{success:true,data:{
 categories:[{name:'单人餐',meals:['a','b','c','d'].map(code=>({code}))},{name:'鸡肉汉堡',meals:[{code:'a'}]}],
 meals:{a:{name:'汉堡三件套',currentPrice:30,image:'https://evil.example/a'},b:{name:'会员套餐',currentPrice:20},c:{name:'普通套餐',currentPrice:25,discountType:'会员价'},d:{name:'可乐',currentPrice:8}}
 }}}};
 const menu=normalizeMenu(snapshot,{storeCode:'1',storeName:'餐厅',address:'地址'});assert.equal(menu.meals.length,1);assert.equal(menu.meals[0].image,'');
 assert.throws(()=>normalizeMenu({result:{structuredContent:{success:false}}},{}));
});
test('detail includes only default choices',()=>{
 const r=normalizeDetail({result:{structuredContent:{success:true,data:{name:'套餐',rounds:[{choices:[{name:'薯条',isDefault:1,quantity:1},{name:'鸡块',isDefault:0}]}]}}}});
 assert.deepEqual(r.defaults.map(x=>x.name),['薯条']);
});

test('snacks and drinks coexist with a main meal and count separately',()=>{
 let records=upsertRecord([],draft,now).records;
 records=upsertRecord(records,{...draft,id:'s',sourceDrawId:'s',kind:'snack',name:'薯条'},now).records;
 records=upsertRecord(records,{...draft,id:'d',sourceDrawId:'d',kind:'drink',name:'可乐'},now).records;
 records=upsertRecord(records,{...draft,id:'s2',sourceDrawId:'s2',kind:'snack',name:'麦乐鸡'},now).records;
 assert.deepEqual(summarize(records,'week',now).kinds,{meal:1,snack:2,drink:1});
 assert.equal(validateState({...defaultState(),records}).records.length,4);
 assert.equal(upsertRecord(records,{...draft,id:'m2',sourceDrawId:null},now).conflict.id,'a');
 assert.throws(()=>upsertRecord([],{...draft,kind:'unknown'},now));
});
test('legacy records keep meal classification without losing source deduplication',()=>{
 const records=[draft]; assert.deepEqual(summarize(records,'month',now).kinds,{meal:1,snack:0,drink:0});
 assert.equal(upsertRecord(records,{...draft,id:'new',kind:'drink'},now).existing.id,'a');
});
test('menu separates snacks, desserts and coffee and excludes sauces or merchandise',()=>{
 const items={a:['薯条','小食甜品'],b:['可乐','饮品'],c:['美式咖啡','麦咖啡'],d:['麦旋风','小食甜品'],e:['山葵酱','炸鸡'],f:['按摩捶痒痒挠','小食甜品']};
 const data={meals:{},categories:[]};
 for(const [code,[name,category]] of Object.entries(items)){data.meals[code]={name,currentPrice:10};data.categories.push({name:category,meals:[{code}]});}
 const result=normalizeMenu({result:{structuredContent:{success:true,data}}},{});
 assert.deepEqual(result.meals.map(m=>[m.id,m.group]),[['a','snack'],['b','drink'],['c','drink'],['d','snack']]);
});
