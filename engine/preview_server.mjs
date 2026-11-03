// 预览服务：引擎代码从 skill 自身目录读取，项目内容从 --project 读取。
// 用法：node preview_server.mjs --project /path/to/episode
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ENGINE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const argProject = process.argv.indexOf('--project');
const PROJECT_ROOT = argProject >= 0
  ? path.resolve(process.argv[argProject + 1] || process.cwd())
  : ENGINE_ROOT;
const PORT = Number(process.env.PREVIEW_PORT || 8787);
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.mp4':'video/mp4', '.mov':'video/quicktime', '.mkv':'video/x-matroska',
  '.srt':'text/plain; charset=utf-8', '.ttf':'font/ttf',
  '.woff2':'font/woff2', '.png':'image/png', '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.mp3':'audio/mpeg',
  '.wav':'audio/wav',
};

const build = () => new Promise((resolve, reject) => {
  execFile('node', [path.join(ENGINE_ROOT, 'build.mjs'), '--project', PROJECT_ROOT],
    (error, stdout, stderr) => error ? reject(stderr || error) : resolve(stdout));
});

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function safeFile(root, requestPath) {
  const rel = decodeURIComponent(requestPath).replace(/^\/+/, '');
  const file = path.resolve(root, rel);
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

function sourceForRequest(pathname) {
  if (pathname === '/' || pathname === '/index.html')
    return { file:path.join(ENGINE_ROOT,'index.html'), root:ENGINE_ROOT };
  if (pathname === '/preview.js' || pathname === '/segmode.js' ||
      pathname === '/charmode.js' || pathname.startsWith('/assets/')) {
    const file = safeFile(ENGINE_ROOT, pathname);
    return file ? { file, root:ENGINE_ROOT } : null;
  }
  if (pathname === '/timeline.js')
    return { file:path.join(PROJECT_ROOT,'timeline.js'), root:PROJECT_ROOT };
  const file = safeFile(PROJECT_ROOT, pathname);
  return file ? { file, root:PROJECT_ROOT } : null;
}

try {
  const out = await build();
  console.log(`BUILD ${String(out).trim()}`);
} catch (error) {
  console.warn(`预览前构建失败，可先修改 timeline.json：${String(error).trim()}`);
}

const LOG = path.join(PROJECT_ROOT, '.rebuild.log');
let building = false;

function runRebuild() {
  if (building) return { ok:false, busy:true };
  building = true;
  fs.writeFileSync(LOG, '开始重建 ' + new Date().toLocaleString() + '\n');
  const script = ['rebuild.sh','make_final.sh']
    .find(name => fs.existsSync(path.join(PROJECT_ROOT, name)));
  if (!script) {
    building = false;
    fs.appendFileSync(LOG, '\n找不到 rebuild.sh / make_final.sh；预览仍可编辑和即时试删。\n');
    return { ok:false, error:'rebuild script not found' };
  }
  fs.appendFileSync(LOG, '\n执行 ' + script + '\n');
  const child = spawn('bash', [script], { cwd:PROJECT_ROOT, env:process.env });
  const tee = buffer => { try { fs.appendFileSync(LOG, buffer.toString()); } catch {} };
  child.stdout.on('data', tee);
  child.stderr.on('data', tee);
  child.on('close', code => {
    building = false;
    fs.appendFileSync(LOG,
      '\n==== 结束 exit=' + code + ' ' + new Date().toLocaleTimeString() + ' ====\n');
  });
  return { ok:true, script };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'POST' && url.pathname === '/api/save') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { file, data } = JSON.parse(body);
        const allowed = ['timeline.json', 'deletions.json'];
        if (!allowed.includes(file)) return send(res, 400, 'file not allowed');
        const target = path.join(PROJECT_ROOT, file);
        if (fs.existsSync(target)) fs.copyFileSync(target, target + '.bak');
        fs.writeFileSync(target, JSON.stringify(data, null, 1), 'utf8');
        const out = file === 'timeline.json' ? await build() : 'saved';
        send(res, 200,
          '{"ok":true,"build":' + JSON.stringify(String(out).trim()) + '}',
          'application/json; charset=utf-8');
      } catch (error) {
        send(res, 500, String(error));
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/rebuild') {
    req.on('data', () => {});
    req.on('end', () => {
      let result;
      try { result = runRebuild(); }
      catch (error) { result = { ok:false, error:String(error) }; }
      send(res, 200, JSON.stringify(result), 'application/json; charset=utf-8');
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/progress') {
    let log = '';
    try { log = fs.readFileSync(LOG, 'utf8'); } catch {}
    send(res, 200, JSON.stringify({ running:building, log:log.slice(-6000) }),
      'application/json; charset=utf-8');
    return;
  }

  const source = sourceForRequest(url.pathname);
  if (!source) return send(res, 403, 'forbidden');
  let stat;
  try { stat = fs.statSync(source.file); } catch { return send(res, 404, 'not found'); }
  if (!stat.isFile()) return send(res, 404, 'not found');

  if (path.extname(source.file).toLowerCase() === '.html') {
    let html = fs.readFileSync(source.file, 'utf8');
    html = html.replace(/(src=")([A-Za-z0-9_\-]+\.js)(")/g, (match, before, name, after) => {
      try {
        const scriptFile = path.join(source.root, name);
        return before + name + '?v=' + fs.statSync(scriptFile).mtimeMs + after;
      } catch { return match; }
    });
    res.writeHead(200, {
      'Content-Type':'text/html; charset=utf-8',
      'Cache-Control':'no-store, no-cache, must-revalidate',
    });
    res.end(html);
    return;
  }

  const type = MIME[path.extname(source.file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range) || [];
    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Type':type, 'Accept-Ranges':'bytes',
      'Content-Range':`bytes ${start}-${end}/${stat.size}`,
      'Content-Length':end - start + 1, 'Cache-Control':'no-store',
    });
    fs.createReadStream(source.file, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type':type, 'Content-Length':stat.size, 'Accept-Ranges':'bytes',
    'Cache-Control':'no-store, no-cache, must-revalidate',
  });
  fs.createReadStream(source.file).pipe(res);
});

let tryPort = PORT;
let tries = 0;
function listen() {
  server.listen(tryPort, '127.0.0.1', () => {
    console.log(`PREVIEW_URL=http://127.0.0.1:${tryPort}/index.html?preview=1&edit=1`);
    console.log(`PROJECT=${PROJECT_ROOT}`);
    console.log(`ENGINE=${ENGINE_ROOT}`);
  }).on('error', error => {
    if (error.code === 'EADDRINUSE' && ++tries < 20) {
      tryPort++;
      listen();
    } else {
      console.error(error);
      process.exit(1);
    }
  });
}
listen();
