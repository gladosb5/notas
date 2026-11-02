// Builds the language files the page loads from the catalogue.
//   i18n/catalogue.json  {strings:[{en,ms,zh}], extra:{search:{en,ms,zh}, reply:{ms,zh}}}
//   -> i18n-ms.js, i18n-zh.js   (window.NOTAS_I18N[code] = {strings:{en:text}, extra})
// A translation whose {0} placeholders differ from the English is refused, so a
// sentence can never lose the number or name it carries.
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const catalogue = JSON.parse(await readFile(path.join(root, 'i18n/catalogue.json'), 'utf8'));
const marks = s => [...String(s).matchAll(/\{\d\}/g)].map(m => m[0]).sort().join(',');
const problems = [];

for (const code of ['ms', 'zh']) {
  const strings = {};
  for (const row of catalogue.strings) {
    const en = row.en, text = row[code];
    if (typeof en !== 'string' || !en.trim()) continue;
    if (typeof text !== 'string' || !text.trim()) { problems.push(`${code}: no translation for ${JSON.stringify(en)}`); continue; }
    if (marks(en) !== marks(text)) { problems.push(`${code}: placeholders differ in ${JSON.stringify(en)}`); continue; }
    if (text === en) continue;
    strings[en] = text;
  }
  const extra = {};
  if (catalogue.extra?.search?.[code]) extra.search = catalogue.extra.search[code];
  if (catalogue.extra?.reply?.[code]) extra.reply = catalogue.extra.reply[code];
  const body = '/* built by scripts/build-i18n.mjs from i18n/catalogue.json; edit the catalogue, not this file */\n' +
    'window.NOTAS_I18N=window.NOTAS_I18N||{};\n' +
    `window.NOTAS_I18N.${code}=${JSON.stringify({strings, extra})};\n`;
  await writeFile(path.join(root, `i18n-${code}.js`), body);
  console.log(`i18n-${code}.js: ${Object.keys(strings).length} strings`);
}
if (problems.length) {
  console.log(problems.length + ' entries skipped:');
  for (const p of problems.slice(0, 40)) console.log('  ' + p);
}
