import fs from 'node:fs';
import path from 'node:path';
const root = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const tl = JSON.parse(fs.readFileSync(path.join(root,'timeline.json'),'utf8'));
// 预览模式（?preview=1）的画面源：自动找 renders/ 里的「纯人声版」——
// 它就是剪完+归一化后的原片（有画面、有人声、无字无音乐），正好拿来垫底。
// 只写进 timeline.js（编译产物），不碰手写的 timeline.json。
try{
  const rd = path.join(root,'renders');
  const hit = fs.readdirSync(rd).find(f=>/纯人声版\.mp4$/.test(f));
  if(hit) tl.meta.previewSrc = 'renders/' + hit;
}catch(e){}

/* ---- 逐字删除：把「字级时间轴 / 切片映射 / 待删区间」编进 timeline.js ----
   cuts.json    基线切片（src<->out 映射），浏览器靠它把「原片时间」换算成「成片时间」
   chars.json   校订稿逐字 + 每个字的原片/成片时间（mkchars.py 产出）
   deletions.json  待删的词（原片时间区间），浏览器据此重映射时间轴并跳过被删区间 */
const jread=(f)=>{try{return JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));}catch(e){return null;}};
const _cuts=jread('cuts.json'), _chars=jread('chars.json'), _dels=jread('deletions.json');
if(_cuts&&_cuts.rows) tl.meta.cuts=_cuts.rows;
if(_chars&&_chars.chars) tl.meta.chars=_chars.chars;
if(_dels&&_dels.dels&&_dels.dels.length) tl.meta.dels=_dels.dels;
fs.writeFileSync(path.join(root,'timeline.js'), 'window.__TIMELINE__ = ' + JSON.stringify(tl) + ';\n');
const errs=[];
const DEV=['drop','wipe','slam','slideL','type','fade','split'];
let prevT1=-1;
for(const g of tl.groups){
  if(g.dead) continue;                       // 整段被删掉的组：不参与校验，也不渲染
  if(g.t1<=g.t0) errs.push(`${g.id}: t1<=t0`);
  if(g.t0<prevT1-0.45) errs.push(`${g.id}: overlaps previous group by more than 0.45s`);
  prevT1=g.t1;
  if(g.t1>tl.meta.total+0.01) errs.push(`${g.id}: t1 beyond total`);
  const mains=g.items.filter(i=>i.role==='main');
  const subs=g.items.filter(i=>i.role==='sub');
  const ghosts=g.items.filter(i=>i.role==='ghost');
  const cracks=g.items.filter(i=>i.role==='crack');
  if(mains.length!==1) errs.push(`${g.id}: needs exactly 1 main`);
  if(g.items.length>3) errs.push(`${g.id}: ${g.items.length} items > 3`);
  const main=mains[0];
  const plain=main.text.replace(/\*/g,'');
  const cjk=[...plain].filter(c=>/[\u4e00-\u9fff]/.test(c)).length;
  const words=(plain.match(/[A-Za-z]+/g)||[]).length;
  const zi=cjk+words;
  if(zi>8) errs.push(`${g.id}: main "${plain}" = ${zi} 字 (max 8)`);
  if(main.size<88||main.size>160) errs.push(`${g.id}: main size ${main.size} out of 88..160`);
  if(!DEV.includes(main.device)) errs.push(`${g.id}: bad device ${main.device}`);
  const est=[...plain].reduce((w,c)=>w+(/[\u4e00-\u9fff]/.test(c)?1.0:0.56),0)*main.size;
  if(est>1000) errs.push(`${g.id}: estimated width ${Math.round(est)}px > 1000px`);
  for(const s of subs){
    const sp=s.text.replace(/\*/g,'');
    const sc=[...sp].filter(c=>/[\u4e00-\u9fff]/.test(c)).length + (sp.match(/[A-Za-z]+/g)||[]).length;
    if(sc>12) errs.push(`${g.id}: sub "${sp}" = ${sc} 字 (max 12)`);
    if(s.size<44||s.size>64) errs.push(`${g.id}: sub size ${s.size} out of 44..64`);
    const se=[...sp].reduce((w,c)=>w+(/[\u4e00-\u9fff]/.test(c)?1.0:0.56),0)*s.size;
    if(se>1000) errs.push(`${g.id}: sub estimated width ${Math.round(se)}px > 1000px`);
  }
  for(const ck of cracks){
    const cp=ck.text.replace(/\*/g,'');
    const cc=[...cp].filter(c=>/[\u4e00-\u9fff]/.test(c)).length+(cp.match(/[A-Za-z]+/g)||[]).length;
    if(cc>8) errs.push(`${g.id}: crack "${cp}" = ${cc} 字 (max 8)`);
    if(ck.size<80||ck.size>140) errs.push(`${g.id}: crack size ${ck.size} out of 80..140`);
    if(ck.t0<g.t0-0.001||ck.t1>g.t1+0.001) errs.push(`${g.id}: crack window outside group`);
  }
  if(main.device==='split'){
    const sp=main.split;
    if(!sp) errs.push(`${g.id}: device=split needs a split{} param`);
    else{
      if(typeof sp.at!=='number'||typeof sp.gap!=='number'||typeof sp.dur!=='number')
        errs.push(`${g.id}: split needs numeric at/gap/dur`);
      if(sp.gap<20||sp.gap>120) errs.push(`${g.id}: split gap ${sp.gap} out of 20..120`);
      if(sp.dur<0.3||sp.dur>2) errs.push(`${g.id}: split dur ${sp.dur} out of 0.3..2`);
      if(/\n/.test(main.text)) errs.push(`${g.id}: split must be a single line`);
      if(cracks.length!==1) errs.push(`${g.id}: split group needs exactly 1 crack`);
      else{
        const gapH=sp.gap*2, cH=cracks[0].size*1.06;
        if(cH>gapH) errs.push(`${g.id}: crack height ${Math.round(cH)} > gap ${gapH}`);
        const need=main.size*1.06+gapH+cH;
        if(g.y+need>tl.meta.height-30) errs.push(`${g.id}: split block bottom ${Math.round(g.y+need)} overflows`);
        if(g.y-sp.gap<tl.meta.height*0.30) errs.push(`${g.id}: split top ${Math.round(g.y-sp.gap)} too high`);
        const crackStart=main.t0+sp.at+sp.dur;
        if(cracks[0].t0<crackStart-0.35) errs.push(`${g.id}: crack starts before the crack opens (${crackStart.toFixed(2)})`);
      }
    }
  }
  for(const gh of ghosts){
    const gp=gh.text.replace(/\*/g,'');
    const gc=[...gp].filter(c=>/[\u4e00-\u9fff]/.test(c)).length+(gp.match(/[A-Za-z]+/g)||[]).length;
    if(gc>6) errs.push(`${g.id}: ghost "${gp}" = ${gc} 字 (max 6)`);
  }
  // 版面：块高必须落在画面内
  let blockH = main.size*1.16 + (subs.length? subs[0].size*1.25+22 : 0);
  if(main.device==='split'&&main.split&&cracks.length){
    blockH = Math.max(blockH, main.size*1.06 + main.split.gap*2 + cracks[0].size*1.06);
  }
  if(g.y + blockH > tl.meta.height-30) errs.push(`${g.id}: block bottom ${Math.round(g.y+blockH)} overflows`);
  const yMin = tl.meta.yMin ?? tl.meta.height*0.49;
  const yMax = tl.meta.yMax ?? tl.meta.height*0.78;
  if(g.y < yMin) errs.push(`${g.id}: y ${g.y} above band ${yMin}`);
  if(g.y > yMax) errs.push(`${g.id}: y ${g.y} below band ${yMax}`);
}
if(errs.length){console.error('PRE-FLIGHT FAILED:\n'+errs.join('\n'));process.exit(1);}
const ys=tl.groups.map(g=>g.y);
console.log(`OK groups=${tl.groups.length} total=${tl.meta.total}s yRange=${Math.min(...ys)}..${Math.max(...ys)}`);
