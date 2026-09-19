// Deep-merges a JSON patch into one or more locale files: node scripts/merge-i18n.mjs patch.json en hi
import fs from 'node:fs';
const [patchFile, ...langs] = process.argv.slice(2);
const patch = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
const merge = (a, b) => {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) a[k] = merge(a[k] && typeof a[k] === 'object' ? a[k] : {}, v);
    else a[k] = v;
  }
  return a;
};
for (const lang of langs) {
  const file = `src/i18n/${lang}.json`;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify(merge(data, patch), null, 2) + '\n');
  console.log('merged into', file);
}
