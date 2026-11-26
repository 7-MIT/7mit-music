const { spawn } = require('node:child_process'); const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const root = path.join(__dirname, '..', '..');
async function startServer(port = 3300 + Math.floor(Math.random() * 500), env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auralys-e2e-'));
  const cache = path.join(os.tmpdir(), 'auralys-seed-cache');
  if (fs.existsSync(cache)) fs.cpSync(cache, dir, { recursive: true, filter: s => !/auralys\.db/.test(s) }); // reuse generated audio, fresh DB
  const proc = spawn('node', ['--disable-warning=ExperimentalWarning', path.join(root, 'server/index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('server timeout')), 60000); proc.stdout.on('data', d => { if (String(d).includes('Auralys Web on')) { clearTimeout(t); res(); } }); proc.stderr.on('data', d => process.stderr.write(d)); proc.on('exit', c => rej(new Error('server exit ' + c))); });
  if (!fs.existsSync(cache)) fs.cpSync(dir, cache, { recursive: true, filter: s => !/auralys\.db/.test(s) });
  return { url: `http://localhost:${port}`, dir, stop: () => new Promise(r => { proc.once('exit', r); proc.kill(); }) };
}
let n = 0, failed = 0; const results = [];
async function test(name, fn) { try { await fn(); results.push(['PASS', name]); console.log('  ✓', name); } catch (e) { failed++; results.push(['FAIL', name, e.message]); console.log('  ✗', name, '\n     ', e.message.split('\n')[0]); } }
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
async function signup(page, base, email, name = 'Tester', pw = 'correct horse battery') {
  await page.goto(base + '/login'); await page.click('text=New here? Create an account'); await page.fill('#f-name', name); await page.fill('#f-email', email); await page.fill('#f-pw', pw); await page.click('button[type=submit]'); await page.waitForSelector('.avatar:not(:has(svg))', { timeout: 8000 });
}
module.exports = { startServer, test, assert, signup, results, get failed() { return failed; } };
