// Lists the app's words still in English when it is shown in Chinese.
// Chinese needs no Latin letters, so whatever English is left on the page
// (text, spoken labels, tooltips, placeholders) is a string the catalogue
// does not have yet. Opens the menu, settings, library, popovers and
// shortcuts so their words are on the page too.
//   node scripts/i18n-coverage.mjs [out.json]
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {startServer} from './serve.mjs';

const out = process.argv[2];
const server = await startServer(0), browser = await chromium.launch({headless: true});
const base = `http://127.0.0.1:${server.address().port}`;
const found = new Map();
/* words that stay as they are in every language */
const NAMES = /\b(?:notas|nota|Notas|PDF|pdf|AI|LaTeX|Caveat|IBM Plex Mono|Plex|Page Up|Page Down|Ctrl|ctrl|Shift|Enter|enter|Esc|esc|Tab|Space|space|Alt|Cmd|Apple Pencil|Scribble|Settings|iPad|iPhone|Android|Safari|Chrome|Edge|Cloudflare|Cerebras|Oxion|ttf|otf|woff2?|json|png|jpg|svg|QR|URL|deg|rad|drag|solve|selftest|[A-Z])\b|[⌘⇧?=]/g;
/* letters shown only when the icon font fails */
const FALLBACK = new Set(['dl', 'mic', 'say', 'go']);
const KEEP = /^(nota|notas|notas\.?|pdf|latex|json|png|svg|ttf, otf, woff|ctrl|alt|shift|esc|space|enter|tab|cmd|⌘|hey nota.*|ai|ok|qr|url|deg|rad|[a-z]|[A-Z]|[\d\s.,:+\-×÷=/*^()%·…]+)$/i;

async function harvest(page, where) {
  const list = await page.evaluate(() => {
    const KEEP_SEL = '#lines,#title,.lib-name,.lib-thumb-txt,#page-accessible,#intro,[data-no-i18n],script,style,textarea,code';
    const ATTRS = ['aria-label', 'title', 'placeholder', 'data-placeholder', 'alt', 'aria-valuetext'];
    const got = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === 3) {
        const p = n.parentElement; if (!p || p.closest(KEEP_SEL)) continue;
        const t = n.data.replace(/\s+/g, ' ').trim(); if (t) got.push([t, 'text', p.tagName.toLowerCase() + (p.id ? '#' + p.id : '') + (p.className && typeof p.className === 'string' ? '.' + p.className.split(' ')[0] : '')]);
      } else {
        for (const a of ATTRS) {
          if (!n.hasAttribute(a)) continue;
          if (a !== 'data-placeholder' && n.closest(KEEP_SEL)) continue;
          const t = n.getAttribute(a).replace(/\s+/g, ' ').trim(); if (t) got.push([t, a, n.tagName.toLowerCase() + (n.id ? '#' + n.id : '')]);
        }
      }
    }
    return got;
  });
  for (const [text, kind, el] of list) {
    if (el.endsWith('.fb') && FALLBACK.has(text)) continue;
    /* names and keys stay as they are inside a translated sentence */
    const rest = text.replace(NAMES, ' ');
    if (!/[A-Za-z]{2,}/.test(rest) || KEEP.test(text)) continue;
    if (!found.has(text)) found.set(text, {text, kind, el, where});
  }
}
const step = async (page, name, fn) => { try { await fn(); await page.waitForTimeout(350); await harvest(page, name); } catch (e) { console.log('  could not open', name + ':', e.message.split('\n')[0]); } };

for (const [width, height, touch] of [[1280, 900, false], [390, 844, true]]) {
  const context = await browser.newContext({viewport: {width, height}, hasTouch: touch, isMobile: touch, serviceWorkers: 'block'});
  const page = await context.newPage();
  await page.addInitScript(() => { localStorage.setItem('notas.tut', 'done'); localStorage.getItem('notas.prefs') || localStorage.setItem('notas.prefs', JSON.stringify({language: 'zh'})); });
  await page.goto(base + '/notas.html');
  await page.waitForFunction(() => window.N?.i18n?.lang === 'zh' && document.querySelector('#preparing').classList.contains('done'));
  await page.waitForTimeout(800);
  const esc = () => page.keyboard.press('Escape');
  await harvest(page, 'page');
  await step(page, 'menu', async () => { await page.locator('#btn-menu').click(); });
  await step(page, 'menu scrolled', async () => { await page.evaluate(() => document.querySelector('.sheet')?.scrollTo(0, 1e6)); });
  await step(page, 'disable ai', async () => { await page.locator('#disable-ai').click(); });
  await esc(); await esc();
  await step(page, 'shortcuts', async () => { await page.keyboard.press('?'); });
  await esc();
  await step(page, 'library', async () => { await page.locator('#brand').click(); });
  await esc();
  await step(page, 'downloads', async () => { await page.locator('#btn-downloads').click(); });
  await esc();
  await step(page, 'share', async () => { await page.locator('#btn-share').click(); });
  await esc();
  await step(page, 'pen tray', async () => { await page.evaluate(() => { const b = document.querySelector('.tool[data-tool="pen"]'); b.click(); b.click(); }); });
  await esc();
  await step(page, 'text tray', async () => { const t = page.locator('.tool[data-tool="text"]'); await t.click(); await t.click(); });
  await esc();
  await step(page, 'more tools', async () => { await page.evaluate(() => document.querySelector('#pill-more').click()); });
  await step(page, 'quick maths', async () => { const q = page.locator('#quick-expression'); await q.fill('12*7'); await q.press('Enter'); });
  await context.close();
}
await browser.close(); server.close();
const rows = [...found.values()];
console.log(rows.length + ' strings still in English:');
for (const r of rows) console.log(`  [${r.where} · ${r.kind} · ${r.el}] ${r.text}`);
if (out) await writeFile(out, JSON.stringify(rows, null, 1));
