// 版本馆启动器 — 列出所有版本标签, 选择后在独立目录生成该版本快照并打开浏览器
// 用法: node versions.js  [标签名]   (不带参数则交互选择)
const { execSync, spawn } = require('child_process');
const net = require('net');
const path = require('path');

const REPO = __dirname;
const VER_DIR = path.join(path.dirname(REPO), 'orb-versions');
const BASE_PORT = 8943;

function sh(cmd) {
  return execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
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

async function main() {
  let tags;
  try {
    tags = sh('git tag --sort=-creatordate').split('\n').filter(Boolean);
  } catch (e) {
    console.log('读取版本标签失败: ' + e.message);
    process.exit(1);
  }
  if (!tags.length) {
    console.log('还没有任何版本标签。打第一个版本: git tag -a v1.0 -m "说明"');
    process.exit(0);
  }

  console.log('\n=== 版本馆 ===\n');
  tags.forEach((t, i) => {
    let note = '';
    try {
      note = sh(`git tag -n1 "${t}"`).slice(t.length).replace(/^[\s:]+/, '');
    } catch (e) { /* 无注释 */ }
    console.log(`  ${i + 1}.  ${t.padEnd(10)} ${note}`);
  });

  // 命令行参数直接指定标签
  let tag = null;
  const arg = process.argv[2];
  if (arg) {
    const n = parseInt(arg, 10);
    if (!isNaN(n) && tags[n - 1]) tag = tags[n - 1];
    else if (tags.includes(arg)) tag = arg;
    if (!tag) {
      console.log(`\n找不到版本 "${arg}"`);
      process.exit(1);
    }
  } else {
    const ans = await new Promise((res) => {
      process.stdout.write('\n打开哪个版本? (回车=最新): ');
      process.stdin.once('data', (d) => res(d.toString().trim()));
    });
    const n = parseInt(ans, 10);
    if (!isNaN(n) && tags[n - 1]) tag = tags[n - 1];
    else if (tags.includes(ans)) tag = ans;
    else tag = tags[0];
  }

  console.log(`\n准备打开 ${tag} ...`);
  const dest = path.join(VER_DIR, tag);
  try { sh(`git worktree remove --force "${dest}"`); } catch (e) { /* 不存在 */ }
  try { sh(`git worktree add "${dest}" "${tag}"`); }
  catch (e) { console.log('生成版本快照失败: ' + e.message); process.exit(1); }

  const port = await freePort(BASE_PORT);
  const child = spawn('node', ['server.js', String(port)], {
    cwd: dest, detached: true, stdio: 'ignore',
  });
  child.unref();

  await new Promise((r) => setTimeout(r, 1200));
  const url = `http://localhost:${port}/`;
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  console.log(`\n✓ ${tag} 已在浏览器打开: ${url}`);
  console.log(`  (该版本的独立快照目录: ${dest})`);
  console.log('  关闭方法: 直接删除 orb-versions 目录即可, 主项目不受影响');
  process.exit(0);
}

main();
