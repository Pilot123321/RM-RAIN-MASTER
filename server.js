// Look-Ahead Radar local server.
// Serves the game to the Mac and a steering-wheel controller page to the phone,
// and relays the phone's gyro + pedal input to the game over WebSocket.
//   http://localhost:8080          game (Mac)
//   https://<lan-ip>:8443/wheel    phone over Wi-Fi (self-signed cert, accept once)
//   http://localhost:8080/wheel    phone over USB, after `adb reverse tcp:8080 tcp:8080`
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const HTTP_PORT = +process.env.PORT || 8080;
const HTTPS_PORT = +process.env.HTTPS_PORT || 8443;
const PUB = path.join(__dirname, 'public');
const CERT_DIR = path.join(__dirname, 'certs');

function lanIp() {
  const nets = os.networkInterfaces();
  const order = ['en0', 'en1', 'wlan0', 'eth0'];
  const names = Object.keys(nets).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  for (const n of names) for (const a of nets[n] || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return '127.0.0.1';
}
let IP = lanIp();

// Self-signed certificate so Android Chrome treats the Wi-Fi page as a secure context (motion sensors need it).
function ensureCert() {
  const key = path.join(CERT_DIR, 'key.pem'), crt = path.join(CERT_DIR, 'cert.pem'), stamp = path.join(CERT_DIR, 'ip.txt');
  if (fs.existsSync(key) && fs.existsSync(crt) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === IP) return { key, crt };
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const cnf = path.join(CERT_DIR, 'openssl.cnf');
  fs.writeFileSync(cnf, `[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=look-ahead-radar\n[v3]\nsubjectAltName=IP:${IP},IP:127.0.0.1,DNS:localhost\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-keyout', key, '-out', crt, '-config', cnf], { stdio: 'ignore' });
  fs.writeFileSync(stamp, IP);
  return { key, crt };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const SKELETON_HEAD = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}img{max-width:100%}</style></head><body>';

function urls() {
  IP = lanIp();
  return { app: 'look-ahead-radar', games: games.size, wheels: wheels.size, inputRate, lan: `https://${IP}:${HTTPS_PORT}/wheel`, usb: `http://localhost:${HTTP_PORT}/wheel`, ip: IP, adb: adbState };
}

async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/' || u.pathname === '/index.html') {
      const body = SKELETON_HEAD + fs.readFileSync(path.join(PUB, 'game.html'), 'utf8') + '</body></html>';
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' }); return res.end(body);
    }
    if (u.pathname === '/wheel') {
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' }); return res.end(fs.readFileSync(path.join(PUB, 'wheel.html')));
    }
    if (u.pathname === '/info') { res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' }); return res.end(JSON.stringify(urls())); }
    if (u.pathname === '/qr.svg') {
      const svg = await QRCode.toString(u.searchParams.get('u') || urls().lan, { type: 'svg', margin: 1, color: { dark: '#0A0E13', light: '#FFFFFF' } });
      res.writeHead(200, { 'content-type': TYPES['.svg'], 'cache-control': 'no-store' }); return res.end(svg);
    }
    const f = path.join(PUB, path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (f.startsWith(PUB) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); return res.end(fs.readFileSync(f));
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) { res.writeHead(500); res.end(String(e)); }
}

// --- relay: phones -> games (input), games -> phones (alert state)
const games = new Set(), wheels = new Set();
let inputCount = 0, inputRate = 0;
setInterval(() => { inputRate = inputCount / 2; if (wheels.size && (inputRate === 0) !== (lastRate === 0)) console.log(inputRate ? `Receiving phone input (${inputRate}/s)` : 'Phone connected but sending no input'); lastRate = inputRate; inputCount = 0; }, 2000);
let lastRate = -1;
function broadcast(set, msg, binary) { const s = binary ? msg : typeof msg === 'string' ? msg : JSON.stringify(msg); for (const c of set) if (c.readyState === 1 && !(binary && c.bufferedAmount > 400000)) c.send(s, { binary: !!binary }); }
function phonesChanged() { broadcast(games, { t: 'phones', n: wheels.size }); broadcast(wheels, { t: 'games', n: games.size }); }
function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  // keep connections alive through phone hotspots and NAT that drop quiet sockets
  setInterval(() => { for (const c of wss.clients) { if (!c.isAlive) { c.terminate(); continue; } c.isAlive = false; try { c.ping(); } catch (e) {} } }, 15000);
  wss.on('connection', (ws, req) => {
    const role = new URL(req.url, 'http://x').searchParams.get('role') === 'wheel' ? 'wheel' : 'game';
    const set = role === 'wheel' ? wheels : games, other = role === 'wheel' ? games : wheels;
    set.add(ws); phonesChanged();
    if (role === 'game') console.log(`Game connected (${games.size})`);
    if (role === 'wheel') console.log(`Phone wheel connected (${wheels.size}) from ${req.socket.remoteAddress}`);
    ws.on('message', (data, isBinary) => { if (role === 'wheel') inputCount++; if (isBinary) broadcast(other, data, true); else broadcast(other, data.toString()); });
    const born = Date.now(), who = req.socket.remoteAddress;
    ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', (code) => { set.delete(ws); phonesChanged(); if (role === 'wheel') console.log(`Phone wheel disconnected (${wheels.size}) from ${who} after ${((Date.now() - born) / 1000).toFixed(1)} s, code ${code}`); });
  });
}

// --- USB: keep `adb reverse` in place so the phone's localhost:8080 reaches this Mac (no certificate needed)
let adbState = 'not found';
function adbTick() {
  execFile('adb', ['devices'], (err, out) => {
    if (err) { adbState = 'not found'; return; }
    const devs = out.split('\n').slice(1).filter(l => /\tdevice$/.test(l));
    if (!devs.length) { adbState = 'no device'; return; }
    execFile('adb', ['reverse', `tcp:${HTTP_PORT}`, `tcp:${HTTP_PORT}`], (e2) => {
      const next = e2 ? 'error' : 'ready';
      if (next !== adbState && next === 'ready') console.log(`USB: adb reverse active, open ${urls().usb} on the phone`);
      adbState = next;
    });
  });
}

const httpServer = http.createServer(handler);
attach(httpServer);
httpServer.listen(HTTP_PORT, () => {
  let httpsOk = false;
  try {
    const { key, crt } = ensureCert();
    const s = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, handler);
    attach(s); s.listen(HTTPS_PORT); httpsOk = true;
  } catch (e) { console.warn('HTTPS disabled (openssl failed):', e.message); }
  console.log(`\nLook-Ahead Radar\n  Game (on this Mac):   http://localhost:${HTTP_PORT}`);
  if (httpsOk) console.log(`  Phone over Wi-Fi:     ${urls().lan}   (tap Advanced -> Proceed once)`);
  console.log(`  Phone over USB:       ${urls().usb}   (needs USB debugging; adb reverse is set up automatically)\n`);
  adbTick(); setInterval(adbTick, 5000);
});
