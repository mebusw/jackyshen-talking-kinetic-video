import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const engineRoot = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).flatMap((a,i,arr)=>{
  if (a.startsWith('--')) { const k=a.slice(2); const v=(arr[i+1] && !arr[i+1].startsWith('--'))?arr[i+1]:'1'; return [[k,v]]; }
  return [];
}));
const projectRoot = args.project ? path.resolve(args.project) : engineRoot;
if (fs.existsSync(path.join(projectRoot, 'timeline.json'))) {
  execFileSync('node', [path.join(engineRoot, 'build.mjs'), '--project', projectRoot],
    { stdio:'inherit' });
}
const timelinePath = path.join(projectRoot, 'timeline.js');
if (!fs.existsSync(timelinePath)) {
  throw new Error(`找不到 ${timelinePath}；请先准备 timeline.json 并运行 build.mjs`);
}
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({ headless:true, executablePath:CHROME,
  args:['--force-color-profile=srgb','--disable-lcd-text','--hide-scrollbars','--allow-file-access-from-files','--font-render-hinting=none'] });
const page = await browser.newPage({ viewport:{width:1080,height:1920}, deviceScaleFactor:1 });
await page.addInitScript({ content:fs.readFileSync(timelinePath, 'utf8') });
await page.goto('file://' + path.join(engineRoot,'index.html'), { waitUntil:'load' });

const fontInfo = await page.evaluate(async () => {
  const specs = new Set();
  document.querySelectorAll('.item').forEach(el=>{
    const cs=getComputedStyle(el);
    specs.add(`${cs.fontWeight} ${el.style.fontSize} "${cs.fontFamily.split(',')[0].replace(/"/g,'')}"`);
  });
  specs.add('900 52px "Noto Sans SC"'); specs.add('900 48px "Noto Sans SC"');
  specs.add('400 112px "brush"');   // 裂开后的第二句（手写体 brush.ttf）
  await Promise.all([...specs].map(s=>document.fonts.load(s)));
  await document.fonts.ready;
  document.body.getBoundingClientRect();
  const probe=document.querySelector('.item.main .tw');
  const rects=[...document.querySelectorAll('.item')].slice(0,3).map(el=>{const r=el.getBoundingClientRect();return {y:Math.round(r.y),h:Math.round(r.height),w:Math.round(r.width)};});
  return { specs:[...specs], ready:document.fonts.status,
    checkNoto:document.fonts.check('900 104px "Noto Sans SC"'),
    checkBrush:document.fonts.check('400 112px "brush"'),
    probeRect: probe?probe.getBoundingClientRect().toJSON():null, rects,
    items:document.querySelectorAll('.item').length };
});
console.log('fonts:', JSON.stringify(fontInfo));
await page.waitForFunction(()=>window.__READY__===true, null, {timeout:15000});
const total = await page.evaluate(()=>window.__TOTAL__);
const groups = await page.evaluate(()=>window.__GROUPS__);
const outDir = path.join(projectRoot, args.out || 'overlay');
fs.mkdirSync(outDir, { recursive:true });

async function grab(t,file){
  await page.evaluate(t=>{window.__seek(t);}, t);
  await page.screenshot({ path:file, type:'png', omitBackground:true });
}
if (args.samples){
  for (const g of groups){
    const t = g.t0 + (g.t1-g.t0)*0.72;
    await grab(t, path.join(outDir, `${g.id}.png`));
    console.log(`${g.id}  t=${t.toFixed(2)}`);
  }
} else if (args.mid){
  // 入场中 / 出场中 抽样
  for (const g of groups){
    for (const [tag,t] of [['in',g.t0+0.18],['out',g.t1-0.05]]){
      await grab(t, path.join(outDir, `${g.id}-${tag}.png`));
    }
    console.log(`${g.id} mid ok`);
  }
} else {
  const fps = Number(args.fps||30);
  const start = Number(args.start||0);
  const end = Math.min(Number(args.end||total), total);
  const i0 = Math.floor(start*fps), i1 = Math.ceil(end*fps);
  for (let n=i0;n<i1;n++){
    const t=n/fps;
    const file=path.join(outDir, `frame-${String(n).padStart(6,'0')}.png`);
    if (fs.existsSync(file) && !args.force) continue;
    await grab(t,file);
    if (n%120===0) console.log(`frame ${n}/${i1}`);
  }
  console.log(`done ${i0}..${i1}`);
}
await browser.close();
