// Verifies every static t('key') used in src exists in en.json, and that every locale
// covers the keys it must: driver/shared keys in all six languages, admin keys in en + hi.
import fs from 'node:fs';
import path from 'node:path';
const load = (l) => JSON.parse(fs.readFileSync(`src/i18n/${l}.json`, 'utf8'));
const flat = (o, p = '', out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object') flat(v, key, out);
    else out[key] = v;
  }
  return out;
};
const base = (k) => k.replace(/_(one|other|zero|two|few|many)$/, '');
const en = flat(load('en'));
const enBase = new Set(Object.keys(en).map(base));
const ADMIN_ONLY = /^(admin|notifAdmin|map)\./;
let problems = 0;
// 1. static keys used in code
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && files.push(p); } };
walk('src');
const used = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/i18nKey="([a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
}
for (const k of used) if (!enBase.has(k)) { console.log('MISSING in en:', k); problems++; }
// 2. locale coverage
for (const l of ['hi', 'kn', 'mr', 'ta', 'te']) {
  const tr = flat(load(l));
  const trBase = new Set(Object.keys(tr).map(base));
  for (const k of Object.keys(en)) {
    if (ADMIN_ONLY.test(k) && l !== 'hi') continue;
    if (!trBase.has(base(k))) { console.log(`MISSING in ${l}:`, k); problems++; }
    else if (l !== 'en' && tr[k] !== undefined && tr[k] === en[k] && /[a-z]{4,}/.test(en[k].replace(/\{\{\w+\}\}/g, '')) && !en[k].includes('@') && !/^(RC|PUC|UPI|OTP|GR-|ID)/.test(en[k])) {
      console.log(`UNTRANSLATED in ${l}:`, k, '=', en[k]); problems++;
    }
  }
}
console.log(problems ? `${problems} problem(s)` : `i18n OK — ${used.size} static keys used, ${Object.keys(en).length} keys in en`);
process.exit(problems ? 1 : 0);
