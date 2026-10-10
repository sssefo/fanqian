export const RARITIES = [
  { id: 'blue', name: '日常好签', chance: .65, color: '#386490', line: '平常的一餐，也值得好好吃。' },
  { id: 'purple', name: '惊喜好签', chance: .25, color: '#785181', line: '今天的快乐，加一份。' },
  { id: 'red', name: '隐藏好签', chance: .08, color: '#a4352d', line: '这一口，值得期待。' },
  { id: 'gold', name: '金色传说', chance: .02, color: '#88610b', line: '普通的一餐，也能金光登场。' },
];
export const GROUPS = {meal:'正餐',snack:'小吃甜品',drink:'饮品'};
export const SLOTS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', other: '其他' };
export function today(now = Date.now()) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }
export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;
}
export function nameKey(value) { return value.normalize('NFC').trim().toLowerCase(); }
export function validateRecord(record, now = Date.now(), historical = false) {
  const name = typeof record.name === 'string' ? record.name.normalize('NFC').trim() : '';
  if (!name || [...name].length > 20 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('菜名请填写1–20个字，不含控制字符。');
  if (!validDate(record.date) || (!historical && record.date > today(now))) throw new Error('请选择今天或之前的有效日期。');
  if (!Object.hasOwn(SLOTS, record.slot)) throw new Error('请选择餐次。');
  if (record.kind !== undefined && !Object.hasOwn(GROUPS,record.kind)) throw new Error('记录类别无效');
  return { ...record, name, kind:record.kind || 'meal' };
}
export function range(period, now = Date.now()) {
  const date = today(now), d = new Date(date + 'T00:00:00Z');
  if (period === 'month') return { start: date.slice(0,7) + '-01',
    end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)).toISOString().slice(0,10) };
  const weekday = (d.getUTCDay() + 6) % 7;
  const start = new Date(d.valueOf() - weekday * 86400000);
  return { start: start.toISOString().slice(0,10),
    end: new Date(start.valueOf() + 6 * 86400000).toISOString().slice(0,10) };
}
export function summarize(records, period, now = Date.now()) {
  const bounds = range(period, now), slots = Object.keys(SLOTS);
  const rows = records.filter(r => r.date >= bounds.start && r.date <= bounds.end)
    .sort((a,b) => b.date.localeCompare(a.date) || slots.indexOf(a.slot)-slots.indexOf(b.slot));
  const counts = new Map();
  for (const r of rows) {
    const key = nameKey(r.name);
    const entry = counts.get(key) || { key, name: r.name, count: 0 };
    entry.count++; counts.set(key, entry);
  }
  const top = [...counts.values()].sort((a,b) => b.count-a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0,3);
  const kinds={meal:0,snack:0,drink:0};for(const r of rows) kinds[r.kind||'meal']++;
  return { ...bounds, rows, top, count: rows.length, kinds };
}
function unit(random) {
  const v = random();
  if (!Number.isFinite(v) || v < 0 || v >= 1) throw new Error('随机值无效');
  return v;
}
export function drawMeal(meals, disabled, recent, random = Math.random) {
  const active = meals.filter(m => !disabled.includes(m.id));
  if (!active.length) throw new Error('先启用至少一个餐品，再来抽取。');
  const held = recent.slice(-3);
  let candidates;
  do {
    candidates = active.filter(m => !held.includes(m.id));
    if (!candidates.length) held.shift();
  } while (!candidates.length);
  const meal = candidates[Math.floor(unit(random) * candidates.length)];
  const r = unit(random);
  const rarity = r < .65 ? 'blue' : r < .90 ? 'purple' : r < .98 ? 'red' : 'gold';
  return { meal: { ...meal }, rarity };
}
export function upsertRecord(records, draft, now = Date.now(), replace = false) {
  const next = validateRecord(draft, now);
  if (typeof next.id !== 'string' || !next.id) throw new Error('记录标识无效');
  const source = next.sourceDrawId && records.find(r => r.sourceDrawId === next.sourceDrawId && r.id !== next.id);
  if (source) return { existing: source };
  const conflict = next.kind==='meal' && records.find(r => (r.kind||'meal')==='meal' && r.date === next.date && r.slot === next.slot && r.id !== next.id);
  if (conflict && !replace) return { conflict };
  return { records: [...records.filter(r => r.id !== next.id && (!conflict || r.id !== conflict.id)), next] };
}
export function defaultState() { return { version: 1, records: [], disabled: [], lastAccepted: null, sound: true, reduced: false }; }
export function validateState(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.records) ||
      !Array.isArray(value.disabled) || !value.disabled.every(x => typeof x === 'string') ||
      typeof value.sound !== 'boolean' || typeof value.reduced !== 'boolean') throw new Error('数据格式异常');
  const ids = new Set(), slots = new Set(), sources = new Set();
  for (const r of value.records) {
    validateRecord(r, Date.now(), true);
    const slot = r.date + ':' + r.slot;
    if (typeof r.id !== 'string' || !r.id || ids.has(r.id) || ((r.kind||'meal')==='meal' && slots.has(slot)) ||
        (r.sourceDrawId && (typeof r.sourceDrawId !== 'string' || sources.has(r.sourceDrawId)))) throw new Error('记录重复');
    ids.add(r.id); if((r.kind||'meal')==='meal') slots.add(slot); if (r.sourceDrawId) sources.add(r.sourceDrawId);
  }
  const a = value.lastAccepted;
  if (a !== null && (!a || typeof a.drawId !== 'string' || !a.meal ||
      typeof a.meal.name !== 'string' || !a.meal.name.trim() ||
      !RARITIES.some(r => r.id === a.rarity))) throw new Error('选择数据异常');
  return value;
}
