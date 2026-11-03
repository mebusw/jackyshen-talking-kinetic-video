// 预览服务：静态托管本集目录（支持 Range，视频能拖）+ 保存接口（写 timeline.json 并重建 timeline.js）
// 用法：node preview_server.mjs   →  http://127.0.0.1:8787/index.html?preview=1
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PREVIEW_PORT || 8787);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.mp4':'video/mp4', '.mov':'video/quicktime', '.srt':'text/plain; charset=utf-8',
  '.ttf':'font/ttf', '.woff2':'font/woff2', '.png':'image/png', '.jpg':'image/jpeg' };

const rebuild = () => new Promise((ok, no) =>
  execFile('node', [path.join(ROOT, 'build.mjs')], (e, out, err) => e ? no(err || e) : ok(out)));

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  // ---- 保存 ----
  if (req.method === 'POST' && url.pathname === '/api/save') {
    let buf = '';
    req.on('data', c => buf += c);
    req.on('end', async () => {
      try {
        const { file, data } = JSON.parse(buf);
        const allow = ['timeline.json', 'deletions.json'];
        if (!allow.includes(file)) return send(res, 400, 'file not allowed');
        const p = path.join(ROOT, file);
        if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak');   // 每次保存留一份 .bak
        fs.writeFileSync(p, JSON.stringify(data, null, 1), 'utf8');
        let out = 'saved';
        if (file === 'timeline.json') out = await rebuild();
        send(res, 200, '{"ok":true,"build":' + JSON.stringify(String(out).trim()) + '}',
             'application/json; charset=utf-8');
      } catch (e) { send(res, 500, String(e)); }
    });
    return;
  }

  // ---- 重建（后台跑整条流水线，日志写到 .rebuild.log）----
  const LOG = path.join(ROOT, '.rebuild.log');
  let building = false;
  function runRebuild(){
    if (building) return { ok:false, busy:true };
    building = true;
    fs.writeFileSync(LOG, '开始重建 ' + new Date().toLocaleString() + '\n');
    const script = ['rebuild.sh','make_final.sh'].find(s => fs.existsSync(path.join(ROOT, s)));
    if (!script) { building = false; fs.appendFileSync(LOG, '\n找不到 rebuild.sh / make_final.sh\n'); return {ok:false}; }
    fs.appendFileSync(LOG, '\n执行 ' + script + '\n');
    const p = spawn('bash', [script], { cwd: ROOT, env: process.env });
    const tee = (buf) => { try { fs.appendFileSync(LOG, buf.toString()); } catch(e){} };
    p.stdout.on('data', tee); p.stderr.on('data', tee);
    p.on('close', code => {
      building = false;
      fs.appendFileSync(LOG, '\n==== 结束 exit=' + code + ' ' + new Date().toLocaleTimeString() + ' ====\n');
    });
    return { ok:true, script };
  }

  if (req.method === 'POST' && url.pathname === '/api/rebuild') {
    req.on('data', c => {});
    req.on('end', () => {
      let r; try { r = runRebuild(); } catch(e) { r = { ok:false, error:String(e) }; }
      send(res, 200, JSON.stringify(r), 'application/json; charset=utf-8');
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/progress') {
    let log = '';
    try { log = fs.readFileSync(LOG, 'utf8'); } catch(e) {}
    send(res, 200, JSON.stringify({ running: building, log: log.slice(-6000) }),
         'application/json; charset=utf-8');
    return;
  }

  // ---- 静态文件（带 Range，视频可拖）----
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden');
  let st;
  try { st = fs.statSync(file); } catch { return send(res, 404, 'not found'); }
  if (!st.isFile()) return send(res, 404, 'not found');

  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

  /* HTML：把本地脚本的 src 加上「文件修改时间」当版本号。
     否则浏览器/代理会缓存旧的 js，改了代码页面还在跑老逻辑（这个坑踩过）。 */
  if (path.extname(file).toLowerCase() === '.html') {
    let html = fs.readFileSync(file, 'utf8');
    html = html.replace(/(src=")([A-Za-z0-9_\-]+\.js)(")/g, (m, a, name, c) => {
      try {
        const st2 = fs.statSync(path.join(ROOT, name));
        return a + name + '?v=' + st2.mtimeMs + c;
      } catch { return m; }
    });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate' });
    res.end(html);
    return;
  }

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    const start = m[1] ? parseInt(m[1]) : 0;
    const end = m[2] ? parseInt(m[2]) : st.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${st.size}`,
      'Content-Length': end - start + 1, 'Cache-Control': 'no-store' });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size,
    'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
  fs.createReadStream(file).pipe(res);
});

// 端口被占就顺延，最多试 20 个
let tryPort = PORT, tries = 0;
function listen() {
  server.listen(tryPort, '127.0.0.1', () => {
    console.log(`PREVIEW_URL=http://127.0.0.1:${tryPort}/index.html?preview=1&edit=1`);
    console.log(`目录：${ROOT}`);
  }).on('error', e => {
    if (e.code === 'EADDRINUSE' && ++tries < 20) { tryPort++; listen(); }
    else { console.error(e); process.exit(1); }
  });
}
listen();
