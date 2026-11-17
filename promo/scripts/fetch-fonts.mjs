// fetch-fonts.mjs — 把 Google Fonts 的 CJK 子集 woff2 一次性下载到 src/fonts/，
// 生成 src/fonts.css（本地 @font-face）。渲染时零网络请求，确定性且快。
// 用法: node scripts/fetch-fonts.mjs
import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {basename} from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FAMILIES = [
  ['Noto Serif SC', 'Noto+Serif+SC:wght@600;900'],
  ['Noto Sans SC', 'Noto+Sans+SC:wght@400;500;700'],
];
mkdirSync('src/fonts', {recursive: true});

let css = '';
const jobs = [];
for (const [name, q] of FAMILIES) {
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${q}&display=swap`, {headers: {'User-Agent': UA}});
  const text = await res.text();
  css += text + '\n';
  for (const m of text.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) jobs.push(m[1]);
}
const urls = [...new Set(jobs)];
console.log(`${urls.length} font files to download`);
let done = 0;
const pool = Array.from({length: 8}, async () => {
  while (urls.length) {
    const u = urls.pop();
    const file = basename(new URL(u).pathname);
    if (!existsSync(`src/fonts/${file}`)) {
      const r = await fetch(u);
      writeFileSync(`src/fonts/${file}`, Buffer.from(await r.arrayBuffer()));
    }
    done++;
    if (done % 50 === 0) console.log(`  ${done} downloaded`);
  }
});
await Promise.all(pool);
css = css.replace(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g, (_, u) => `url('./fonts/${basename(new URL(u).pathname)}')`);
writeFileSync('src/fonts.css', css);
console.log(`done: ${done} files, src/fonts.css written`);