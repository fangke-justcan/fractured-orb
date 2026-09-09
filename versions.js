// 版本馆 — 交互式版本切换器 + 快照服务器
// 用法:
//   node versions.js              交互模式: 反复输入编号/标签切换, 同一网页自动刷新 (q 退出)
//   node versions.js <标签|编号>   直接切到指定版本并打开浏览器 (供 ZCode/脚本调用)
//   node versions.js --serve <端口>  (内部) 启动快照静态服务器
//
// 原理: 所有版本快照轮流挂载到固定目录 orb-versions/current/,
// 服务器始终从该目录读文件; 页面里注入了轮询脚本, 版本一变自动 location.reload()。
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { execSync, spawn } = require('child_process');

const REPO = __dirname;
const VER_DIR = path.join(path.dirname(REPO), 'orb-versions');
const CUR = path.join(VER_DIR, 'current');
const STATE_FILE = path.join(VER_DIR, '.current-version');
const BASE_PORT = 8943;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

// 注入到 HTML 的自动刷新脚本: 轮询当前版本号, 变了就整页重载
const INJECT = '\n<script>(function(){fetch("/__v").then(function(r){return r.text()})' +
  '.then(function(v){window.__snap=v;setInterval(function(){fetch("/__v")' +
  '.then(function(r){return r.text()}).then(function(x){if(x!==window.__snap)location.reload()})' +
  '.catch(function(){})},700)}).catch(function(){})})();</script>\n';

function sh(cmd) {
  return execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function listTags() {
  return sh('git tag --sort=-v:refname').split('\n').filter(Boolean);
}

function freePort(start) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const s = net.createServer();
      s.once('error', () => tryPort(p + 1));
      s.once('listening', () => s.close(() => resolve(p)));
      s.listen(p, '127.0.0.1');
    };
    tryPort(start);
  });
}

function probeOurs(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/__v', timeout: 700 }, (r) => {
      resolve(r.statusCode === 200);
      req.destroy();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  if (await probeOurs(BASE_PORT)) return BASE_PORT;        // 旧服务器还在, 直接复用
  const port = await freePort(BASE_PORT);
  const child = spawn(process.execPath, [__filename, '--serve', String(port)],
    { detached: true, stdio: 'ignore' });
  child.unref();
  await new Promise((r) => setTimeout(r, 600));
  return port;
}

function switchTo(tag) {
  fs.mkdirSync(VER_DIR, { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try { sh(`git worktree remove --force "${CUR}"`); break; }
    catch (e) { if (attempt >= 2) break; }
  }
  sh(`git worktree add "${CUR}" "${tag}"`);
  fs.writeFileSync(STATE_FILE, tag, 'utf8');
}

/* ---------------- --serve: 快照静态服务器 ---------------- */
if (process.argv[2] === '--serve') {
  const port = Number(process.argv[3]) || BASE_PORT;
  http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/__v') {
      let v = 'unknown';
      try { v = fs.readFileSync(STATE_FILE, 'utf8').trim(); } catch (e) { /* 尚未选择 */ }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(v);
    }
    const rel = urlPath === '/' ? '/index.html' : urlPath;
    const file = path.normalize(path.join(CUR, rel));
    if (!file.startsWith(CUR)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('404: ' + urlPath); }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const head = { 'Content-Type': type };
      if (type.startsWith('text/html')) {
        data = Buffer.concat([data, Buffer.from(INJECT, 'utf8')]);
        head['Cache-Control'] = 'no-store';
      }
      res.writeHead(200, head);
      res.end(data);
    });
  }).listen(port, '127.0.0.1', () => console.log('snapshot server on ' + port));
  return;
}

/* ---------------- 主流程 ---------------- */
async function main() {
  const arg = process.argv[2];
  let tags;
  try { tags = listTags(); } catch (e) { console.log('读取版本标签失败: ' + e.message); process.exit(1); }
  if (!tags.length) { console.log('还没有任何版本标签。打第一个: git tag -a v1.0 -m "说明"'); process.exit(0); }

  const port = await ensureServer();
  const url = `http://localhost:${port}/`;
  let opened = false;

  const resolveTag = (input) => {
    const n = parseInt(input, 10);
    if (!isNaN(n) && tags[n - 1]) return tags[n - 1];
    if (tags.includes(input)) return input;
    return null;
  };
  const doSwitch = async (tag) => {
    let cur = '';
    try { cur = fs.readFileSync(STATE_FILE, 'utf8').trim(); } catch (e) { /* 第一次 */ }
    if (tag === cur) { console.log(`  当前已经是 ${tag}, 无需切换`); return; }
    process.stdout.write(`  切换到 ${tag} ... `);
    try { switchTo(tag); console.log('完成, 网页将自动刷新'); }
    catch (e) { console.log('失败: ' + e.message); }
    if (!opened) {
      opened = true;
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  // 参数模式: 直接切换并打开, 供 ZCode / 脚本调用
  if (arg) {
    const tag = resolveTag(arg);
    if (!tag) { console.log('找不到版本: ' + arg); process.exit(1); }
    await doSwitch(tag);
    console.log(`  ${tag} 已上线: ${url}`);
    process.exit(0);
  }

  // 交互模式: 循环接受输入, 直到 q
  const printList = () => {
    console.log('\n=== 版本馆 ===\n');
    tags.forEach((t, i) => {
      let note = '';
      try { note = sh(`git tag -n1 "${t}"`).slice(t.length).replace(/^[\s:]+/, ''); } catch (e) { /* 无注释 */ }
      console.log(`  ${i + 1}.  ${t.padEnd(8)} ${note}`);
    });
    console.log('\n输入 编号 或 标签名 切换版本 (同一网页自动刷新);  l=重新列表  q=退出\n');
  };
  printList();
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('close', () => process.exit(0));           // 输入流结束(管道/Ctrl+C)时安静退出
  rl.on('error', () => process.exit(0));
  const ask = () => {
    if (rl.closed) return process.exit(0);
    rl.question('切换到> ', async (ans) => {
      const s = ans.trim();
      if (s === 'q' || s === 'quit' || s === 'exit') {
        console.log('再见! 快照服务器仍在后台运行: ' + url);
        rl.close();
        process.exit(0);
      }
      if (s === 'l' || s === '') { printList(); return ask(); }
      const tag = resolveTag(s);
      if (!tag) { console.log('  找不到该版本 (输入 l 查看列表)'); return ask(); }
      await doSwitch(tag);
      ask();
    });
  };
  ask();
}

main();
