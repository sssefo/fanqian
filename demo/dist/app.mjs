import {initStores} from './stores.mjs';
import {initCheckout} from './checkout.mjs';
import { RARITIES, SLOTS, GROUPS, today, summarize, drawMeal, upsertRecord, defaultState, validateState } from './domain.mjs';
const $ = id => document.getElementById(id);
const openCheckout=initCheckout(()=>state.lastAccepted);
$('order-last').onclick=openCheckout;
$('result-order').onclick=()=>{if(!current||drawing)return;$('accept-button').click();openCheckout();};
const KEY = 'fanqian.demo.v1';
let state = defaultState(), recovery = false, dirty = false;
try { const raw = localStorage.getItem(KEY); if (raw) state = validateState(JSON.parse(raw)); }
catch { recovery = true; }
let category='meal';
let menu, current = null, recent = [], generation = 0, timer, drawing = false, revealed = 0;
let period = 'week', editing = null, sourceDrawId = null, draftId, toastTimer, audio, rollFrame;
const money = n => '¥' + Number(n).toFixed(1).replace(/\.0$/, '');
const rarity = id => RARITIES.find(r => r.id === id);
function element(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 3400); }
function persist() {
  dirty = true;
  if (!recovery) { try { localStorage.setItem(KEY, JSON.stringify(state)); dirty = false; } catch {} }
  renderStorage(); renderLast(); renderRecords();
}
function renderStorage() {
  $('storage-banner').hidden = !recovery && !dirty;
  $('storage-message').textContent = recovery ? '本地记录读取异常，当前可以体验。恢复前不会覆盖原数据。' : '本次可用，但未保存。';
  $('retry-save').textContent = recovery ? '恢复并保存' : '重试保存';
}
$('retry-save').onclick = () => {
  if (recovery && !confirm('用当前内存数据替换无法读取的旧数据？旧数据可能丢失。')) return;
  recovery = false; persist();
};
function setView(view) {
  if (drawing) return;
  $('draw-view').hidden = view !== 'draw'; $('records-view').hidden = view !== 'records';
  $('nav-draw').classList.toggle('active', view === 'draw');
  $('nav-records').classList.toggle('active', view === 'records');
  if (view === 'records') renderRecords();
}
$('nav-draw').onclick = () => setView('draw');
$('nav-records').onclick = $('review-link').onclick = () => setView('records');
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
document.addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement && !event.target.src.endsWith('/food-placeholder.svg')) event.target.src = '/food-placeholder.svg';
}, true);

const popupContent=$('popup-content');
popupContent.append($('result-card'));
const popupActions=element('div',undefined,'draw-actions');
popupActions.append($('accept-button'),$('redraw-button'));
popupContent.append(popupActions,$('result-extras'));
$('close-result').onclick=()=>$('result-dialog').close('dismiss');
$('result-dialog').addEventListener('close',()=>{
 if(['accepted','redraw'].includes($('result-dialog').returnValue)) return;
 ++generation;clearTimeout(timer);cancelAnimationFrame(rollFrame);
 current=null;audio?.suspend();setLocked(false);resetStage();$('draw-button').focus();
});
function categoryMeals(){return (menu?.meals||[]).filter(m=>(m.group||'meal')===category);}
function updateCategory(){
 for(const g of Object.keys(GROUPS)) $('category-'+g).setAttribute('aria-pressed',String(g===category));
 const meal=categoryMeals()[0];$('hero-food').src=meal?.image||'/food-placeholder.svg';
 $('draw-button').firstElementChild.textContent={meal:'抽一餐',snack:'抽点小吃',drink:'抽杯饮品'}[category];
 updatePool();
}
for(const g of Object.keys(GROUPS)) $('category-'+g).onclick=()=>{if(drawing)return;category=g;current=null;recent=[];revealed=0;resetStage();updateCategory();};

function updatePool() {
  if (!menu) return;
  const count = categoryMeals().filter(m => !state.disabled.includes(m.id)).length;
  $('pool-count').textContent = count;
  $('draw-button').disabled = drawing || count === 0;
  $('redraw-button').disabled = drawing || count === 0;
  if (!count) $('stage-note').textContent = categoryMeals().length ? '签池已全部禁用，去“看看签池”恢复餐品吧。' : '当前门店此时段没有这类餐品，试试其他签池或换店。';
}
async function loadMenu(refresh = false,selectedCode=state.selectedStoreCode||'1980064') {
  $('refresh-button').disabled = true;
  try {
    const response = await fetch(refresh ? '/api/refresh' : '/api/menu?storeCode='+encodeURIComponent(selectedCode), refresh ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeCode:selectedCode})} : {});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '菜单暂不可用');
    menu = data;
    if (!categoryMeals().length) category = Object.keys(GROUPS).find(g => menu.meals.some(m => (m.group || 'meal') === g)) || 'meal';
    state.selectedStoreCode=data.store.code;persist();
    $('edition-store').textContent=data.store.name.replace('麦当劳','').replace('餐厅','');
    $('store-name').textContent = menu.store.name;
    $('store-address').textContent = menu.store.address;
    $('menu-status').textContent = '菜单快照 · ' + new Date(menu.checkedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour:'2-digit', minute:'2-digit' });
    $('hero-food').src = (menu.meals.find(m => m.id === '9900005456') || menu.meals[0]).image || '/food-placeholder.svg';
    updateCategory();
    if (refresh) toast('菜单已更新');
  } catch (e) {
    $('menu-status').textContent = menu ? '更新失败，仍为旧快照' : '菜单读取失败，请重试';
    toast(e.message);if(selectedCode!==menu?.store.code)throw e;
  } finally { $('refresh-button').disabled = drawing; }
}
$('refresh-button').onclick = () => loadMenu(true);
function setLocked(locked) {
  for (const id of ['menu-button','settings-button','nav-draw','nav-records','review-link','refresh-button','record-last','category-meal','category-snack','category-drink','order-last','change-store']) $(id).disabled = locked;
  drawing = locked; updatePool(); if (!locked) renderLast();
}
function unlockAudio() {
  if (!state.sound) return;
  try { audio ||= new AudioContext(); audio.resume().catch(() => {}); } catch {}
}
function tone(frequency, start, duration, volume=.05, type='sine') {
  if (!audio || audio.state !== 'running' || !state.sound) return;
  const osc=audio.createOscillator(), gain=audio.createGain();
  osc.type=type; osc.frequency.setValueAtTime(frequency,start);
  gain.gain.setValueAtTime(.0001,start);
  gain.gain.exponentialRampToValueAtTime(volume,start+.008);
  gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
  osc.connect(gain).connect(audio.destination);osc.start(start);osc.stop(start+duration+.02);
  osc.onended=()=>{osc.disconnect();gain.disconnect();};
}
function rollTick(progress) {
  if (!audio || audio.state !== 'running' || !state.sound) return;
  const t=audio.currentTime;
  tone(900+progress*450,t,.035,.025,'triangle');
  tone(180,t,.028,.025,'sine');
}
function beep(gold=false) {
  unlockAudio();if (!audio || !state.sound) return;
  const t=audio.currentTime, notes=gold?[392,493.88,587.33,783.99]:[329.63,440,554.37];
  notes.forEach((f,i)=>tone(f,t+i*.085,gold?.8:.48,gold?.065:.045));
  tone(82.41,t,.42,.08);
}
function resetStage() {
  $('stage').className = 'stage';
  $('idle-art').hidden = false; $('result-card').hidden = true; $('reel-window').hidden = true;
  $('draw-button').hidden = false; $('accept-button').hidden = true; $('redraw-button').hidden = true;
  $('result-extras').hidden = true;$('result-order').hidden=true; $('stage-note').textContent = '普通的一餐，也能金光登场。';
  $('draw-button').firstElementChild.textContent = {meal:'抽一餐',snack:'抽点小吃',drink:'抽杯饮品'}[category]; updatePool();
}

function openResultPopup(mystery=false) {
 const popup=$('result-dialog');
 popup.className='result-popup '+current.rarity+(mystery?' mystery':'')+((state.reduced||matchMedia('(prefers-reduced-motion: reduce)').matches)?' reduced':'');
 popup.returnValue='';
 $('popup-kind').textContent=GROUPS[current.meal.group||'meal'];
 $('popup-particles').replaceChildren();
 if(['red','gold'].includes(current.rarity)) for(let i=0;i<18;i++) {
  const dot=element('i');const angle=i/18*Math.PI*2;
  dot.style.setProperty('--dx',Math.cos(angle)*(130+i%3*35)+'px');
  dot.style.setProperty('--dy',Math.sin(angle)*(160+i%4*28)+'px');
  dot.style.setProperty('--delay',i%5*.06+'s');
  $('popup-particles').append(dot);
 }
 if(!popup.open) popup.showModal();
}
function showResult(token) {
 if(token!==generation || document.hidden || !current)return;
 recent=[...recent,current.meal.id].slice(-3);revealed++;
 const r=rarity(current.rarity);
 $('reel-window').hidden=true;$('idle-art').hidden=true;$('result-card').hidden=false;
 $('result-card').classList.add('reveal');$('result-name').style.fontSize='';
 $('stage').className='stage '+current.rarity+'-state';
 $('rarity-label').textContent=r.name;$('rarity-label').style.color=r.color;
 $('result-name').textContent=current.meal.name;
 $('result-image').src=current.meal.image||'/food-placeholder.svg';$('result-image').hidden=false;
 $('result-price').textContent='查询时参考价 '+money(current.meal.price);
 $('result-caption').textContent=r.line;
 $('draw-button').hidden=true;$('accept-button').hidden=false;$('redraw-button').hidden=false;
 $('result-order').hidden=false;$('result-extras').hidden=false;$('detail-button').hidden=current.meal.group!=='meal';
 $('stage-note').textContent='好签已揭晓 · 选好了再记一笔';
 setLocked(false);openResultPopup();beep(current.rarity==='gold');
}
function finishRoll(token) {
 if(token!==generation || document.hidden)return;
 const reduced=state.reduced||matchMedia('(prefers-reduced-motion: reduce)').matches;
 if(current.rarity==='gold'&&!reduced) {
  $('reel-window').hidden=true;$('result-card').hidden=true;
  openResultPopup(true);
  tone(196,audio?.currentTime||0,.8,.045);
  timer=setTimeout(()=>showResult(token),1000);
 }else showResult(token);
}
function startDraw() {
  if (drawing || !menu) return;
  try { current={...drawMeal(categoryMeals(),state.disabled,recent),drawId:crypto.randomUUID()}; }
  catch(e) { toast(e.message);return; }
  unlockAudio();
  $('result-dialog').close('redraw');
  const token=++generation;
  setLocked(true);$('result-card').classList.remove('reveal');
  $('stage').className='stage rolling-state';$('result-card').hidden=true;$('idle-art').hidden=true;
  $('result-extras').hidden=true;$('accept-button').hidden=true;$('redraw-button').hidden=true;
  $('draw-button').hidden=false;$('draw-button').firstElementChild.textContent='好签正在路上…';
  $('stage-note').textContent='签带转动中 · 等一个好签';
  const reduced=state.reduced || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced) { timer=setTimeout(()=>showResult(token),200);return; }
  const reel=$('reel');reel.replaceChildren();reel.style.transition='none';
  const winner=52;
  const active=categoryMeals().filter(m=>!state.disabled.includes(m.id));
  for(let i=0;i<58;i++) {
    const m=i===winner?current.meal:active[Math.floor(Math.random()*active.length)];
    const r=i===winner?rarity(current.rarity):RARITIES[Math.random()<.65?0:Math.random()<.72?1:Math.random()<.8?2:3];
    const card=element('div',undefined,'reel-card '+r.id);
    card.style.setProperty('--card-accent',r.color);
    const mystery=i===winner && current.rarity==='gold';
    const img=element('img');img.src=mystery?'/food-placeholder.svg':m.image||'/food-placeholder.svg';img.alt='';
    card.append(element('span',r.name,'reel-tier'),img,element('p',mystery?'金色问号签':m.name),element('small',mystery?'等待揭晓':m.kind));
    reel.append(card);
  }
  $('reel-window').hidden=false;
  const width=reel.firstElementChild.getBoundingClientRect().width, pitch=width+12;
  // Pointer lands inside the chosen card; the animation never changes the result.
  const offset=(Math.random()-.5)*width*.45;
  const start=$('reel-window').clientWidth/2-(3*pitch+width/2);
  const end=$('reel-window').clientWidth/2-(winner*pitch+width/2)+offset;
  const duration=revealed?4500:6200;
  let started, previous=3, lastTick=-100;
  reel.style.transform='translate3d('+start+'px,0,0)';
  $('roll-progress').style.transform='scaleX(0)';
  function frame(now) {
    if(token!==generation || document.hidden) return;
    started ??= now;
    const t=Math.min(1,(now-started)/duration), eased=1-Math.pow(1-t,5);
    const x=start+(end-start)*eased;
    reel.style.transform='translate3d('+x+'px,0,0)';
    $('roll-progress').style.transform='scaleX('+t+')';
    const index=Math.floor(($('reel-window').clientWidth/2-x)/pitch);
    if(index!==previous) {
      if(now-lastTick>45) { rollTick(t);lastTick=now; }
      previous=index;
    }
    if(t>.8) $('stage-note').textContent='即将揭晓 · 好好吃这一餐';
    if(t<1) rollFrame=requestAnimationFrame(frame);
    else {
      reel.children[winner].classList.add('landed');
      $('stage').classList.add('landed-state');
      tone(110,audio?.currentTime||0,.15,.06);
      timer=setTimeout(()=>finishRoll(token),420);
    }
  }
  rollFrame=requestAnimationFrame(frame);
}
$('draw-button').onclick = $('redraw-button').onclick = startDraw;
$('accept-button').onclick = () => {
  if (!current || drawing) return;
  state.lastAccepted = { ...current, store:{...menu.store}, date: today() }; current = null; recent = []; revealed = 0;
  $('result-dialog').close('accepted');persist(); resetStage();updateCategory(); toast('选好了，吃完再记一笔。');
};
$('exclude-button').onclick = () => {
  if (!current) return;
  state.disabled = [...new Set([...state.disabled, current.meal.id])]; persist(); updatePool();
  toast('已移出签池，可在“看看签池”中恢复。');
};
function renderLast() {
  const a = state.lastAccepted;
  $('record-last').disabled = !a || drawing;
  $('order-last').disabled=!a||drawing;
  $('last-name').textContent = a ? a.meal.name : '下一餐，留个念想。';
  const record = a && state.records.find(r => r.sourceDrawId === a.drawId);
  $('last-note').textContent = a ? (record ? '这一餐已经记下来了。' : '选于 ' + (a.date || '') + ' · '+(a.store?.name||'新华东街餐厅')+' · 吃完再确认记录') : '选定后会留在这里，吃完再记一笔。';
  $('record-last').textContent = record ? '已记录 · 查看' : '吃了，记一笔 ＋';
}
$('settings-button').onclick = () => { $('sound-input').checked = state.sound; $('motion-input').checked = state.reduced; $('settings-dialog').showModal(); };
$('sound-input').onchange = e => { state.sound = e.target.checked; if (!state.sound) audio?.suspend(); persist(); };
$('motion-input').onchange = e => { state.reduced = e.target.checked; persist(); };
function renderMenu() {
  const list = $('menu-list'); list.replaceChildren();
  for (const m of categoryMeals()) {
    const label = element('label', undefined, 'menu-item'), img = element('img'), text = element('span', m.name), check = element('input');
    img.src = m.image || '/food-placeholder.svg'; img.alt = '';
    text.append(element('small', money(m.price) + ' · 查询时参考价'));
    check.type = 'checkbox'; check.checked = !state.disabled.includes(m.id);
    check.onchange = () => { state.disabled = check.checked ? state.disabled.filter(x => x !== m.id) : [...new Set([...state.disabled,m.id])]; persist(); updatePool(); };
    label.append(img,text,check); list.append(label);
  }
}
$('menu-button').onclick = () => { renderMenu(); $('menu-dialog').showModal(); };
$('restore-menu').onclick = () => { if (!confirm('恢复全部套餐？吃饭记录会保留。')) return; state.disabled=[]; persist(); renderMenu(); updatePool(); };
$('detail-button').onclick = async () => {
  if (!current) return;
  const id = current.meal.id; $('detail-content').textContent = '正在查询门店套餐搭配…'; $('detail-dialog').showModal();
  try {
    const response = await fetch('/api/detail?storeCode='+encodeURIComponent(menu.store.code)+'&code=' + encodeURIComponent(id));
    const detail = await response.json(); if (!response.ok) throw new Error(detail.error || '详情暂不可用');
    $('detail-content').replaceChildren(element('h3', detail.name));
    for (const c of detail.defaults) {
      const row = element('div', c.name + ' × ' + c.quantity, 'detail-line');
      if(c.supportModify) row.append(element('small','可特调'));
      $('detail-content').append(row);
    }
    if (!detail.defaults.length) $('detail-content').append(element('p','该餐品暂无套餐搭配明细。','muted'));
  } catch(e) { $('detail-content').textContent=e.message; }
};
function openRecord(record = null, accepted = null) {
  editing = record?.id || null; draftId = editing || crypto.randomUUID();
  sourceDrawId = record?.sourceDrawId || accepted?.drawId || null;
  $('form-title').textContent = record ? '修改这餐记录' : '吃了，记一笔';
  $('meal-name').value = record?.name || accepted?.meal.name || '';
  $('meal-date').value = record?.date || today(); $('meal-date').max = today();
  $('meal-kind').value=record?.kind||accepted?.meal.group||'meal';
  $('meal-slot').value = record?.slot || (accepted?.meal.group && accepted.meal.group!=='meal'?'other':'lunch'); $('form-error').textContent='';
  $('delete-record').hidden=!record; $('meal-dialog').showModal();
}
$('record-last').onclick = () => {
  const a = state.lastAccepted; if (!a) return;
  const record = state.records.find(r => r.sourceDrawId === a.drawId);
  openRecord(record || null, a);
};
$('add-record').onclick = () => openRecord();
$('meal-form').onsubmit = event => {
  event.preventDefault();
  const draft={ id:draftId, name:$('meal-name').value, date:$('meal-date').value, slot:$('meal-slot').value, kind:$('meal-kind').value, sourceDrawId };
  try {
    let result = upsertRecord(state.records, draft);
    if (result.existing) { $('form-error').textContent='这一餐已经记录，请从列表编辑。'; return; }
    if (result.conflict) {
      if (!confirm('这天的' + SLOTS[draft.slot] + '已记录“' + result.conflict.name + '”，替换这餐？')) return;
      result = upsertRecord(state.records, draft, Date.now(), true);
    }
    state.records=result.records; persist(); $('meal-dialog').close(); toast(dirty || recovery ? '已记在本次会话，但未保存。' : '这一餐，记下了。');
  } catch(e) { $('form-error').textContent=e.message; }
};
$('delete-record').onclick = () => {
  if (!editing || !confirm('删除这条用餐记录？')) return;
  state.records=state.records.filter(r=>r.id!==editing); persist(); $('meal-dialog').close(); toast('记录已删除');
};
function renderRecords() {
  const review=summarize(state.records,period);
  $('record-count').textContent=review.count;
  $('kind-summary').replaceChildren(...Object.keys(GROUPS).map(g=>element('span',GROUPS[g]+' '+review.kinds[g]+(g==='meal'?'餐':g==='drink'?'杯':'次'))));
  $('date-range').textContent=review.start.replaceAll('-','.')+' — '+review.end.replaceAll('-','.');
  $('top-meals').replaceChildren();
  if (!review.top.length) $('top-meals').append(element('p','吃完记一笔，慢慢攒起来。'));
  for(const item of review.top) {
    const row=element('p'); row.append(element('span',item.name),element('b',item.count+'次')); $('top-meals').append(row);
  }
  const list=$('record-list'); list.replaceChildren();
  if(!review.rows.length) {
    const empty=element('div',undefined,'empty'); empty.append(element('h3','这一页，等你来写。'),element('p','还没有记录。吃完记一笔，或者补记一餐。')); list.append(empty);
  }
  let date,group;
  for(const r of review.rows) {
    if(date!==r.date) { date=r.date; group=element('div',undefined,'day-group'); group.append(element('h3',date)); list.append(group); }
    const button=element('button',undefined,'record-row'); button.append(element('span',GROUPS[r.kind||'meal']+' · '+SLOTS[r.slot]),element('b',r.name),element('span','编辑 ↗'));
    button.onclick=()=>openRecord(r); group.append(button);
  }
}
function setPeriod(next) { period=next; for(const type of ['week','month']) { $(type+'-button').classList.toggle('selected',period===type); $(type+'-button').setAttribute('aria-pressed',period===type); } renderRecords(); }
$('week-button').onclick=()=>setPeriod('week'); $('month-button').onclick=()=>setPeriod('month');
document.addEventListener('visibilitychange',()=>{
  if(document.hidden) {
    audio?.suspend();
    if(drawing) { ++generation; clearTimeout(timer); cancelAnimationFrame(rollFrame); current=null; setLocked(false); $('result-name').style.fontSize=''; resetStage(); if($('result-dialog').open)$('result-dialog').close('dismiss'); }
  } else { renderRecords(); $('meal-date').max=today(); }
});
setInterval(()=>{ if(!document.hidden) renderRecords(); },60000);
initStores({getSelected:()=>menu?.store.code,select:async code=>{
 if(drawing)return;await loadMenu(false,code);current=null;recent=[];revealed=0;resetStage();updateCategory();toast('已切换门店，签池按这家店更新。');
}});
renderStorage(); renderLast(); renderRecords(); loadMenu().catch(()=>{});
