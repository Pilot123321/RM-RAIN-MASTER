// Exercise the complete controller script with a small DOM/media fixture. No browser or camera is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(options = {}) {
  let now = 1000, nextTimer = 0, nextRaf = 0, nextVideo = 0;
  const elements = new Map(), timers = new Map(), rafs = new Map(), videoFrames = new Map(), sockets = [], texts = [];
  const events = new Map();
  const on = (type, callback) => { if (!events.has(type)) events.set(type, []); events.get(type).push(callback); };
  const canvasContext = new Proxy({
    fillText(text) { texts.push(String(text)); },
    measureText(text) { return {width: String(text).length * 7}; },
    getImageData(x, y, width, height) { return {data: new Uint8ClampedArray(width * height * 4)}; },
    createRadialGradient() { return {addColorStop() {}}; },
    createLinearGradient() { return {addColorStop() {}}; },
  }, {get(target, key) { return key in target ? target[key] : () => {}; }});
  function node(id) {
    const classes = new Set(), attributes = new Map(), handlers = new Map();
    return {
      id, hidden: false, textContent: '', width: 1280, height: 720, videoWidth: 1280, videoHeight: 720,
      readyState: 4, currentTime: 1, dataset: {}, style: {setProperty() {}},
      classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) { const add = force === undefined ? !classes.has(name) : !!force; add ? classes.add(name) : classes.delete(name); return add; },
      },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      addEventListener(type, callback) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(callback); },
      dispatch(type, event = {}) { for (const handler of handlers.get(type) || []) handler(event); },
      closest() { return null; }, setPointerCapture() {},
      getContext() { return canvasContext; },
      getBoundingClientRect() { return {left: 0, top: 0, width: this.width, height: this.height}; },
      play: async () => {},
      requestVideoFrameCallback(callback) { const id = ++nextVideo; videoFrames.set(id, callback); return id; },
      cancelVideoFrameCallback(id) { videoFrames.delete(id); },
    };
  }
  const element = id => { if (!elements.has(id)) elements.set(id, node(id)); return elements.get(id); };
  const document = {
    body: node('body'), documentElement: {requestFullscreen: async () => {}}, visibilityState: 'visible',
    getElementById: element, createElement: tag => node(tag), addEventListener: on,
    querySelectorAll: () => [], querySelector: () => null,
  };
  const localStorage = {getItem() { return null; }, setItem() {}};
  const memory = new WebAssembly.Memory({initial: 32});
  const found = 640 * 480 * 4, hom = found + 64, cands = hom + 128, near = cands + 512, fitIn = near + 64, fitOut = fitIn + 2048;
  const phx = {
    memory, markers_frame: () => 0, markers_found: () => found, markers_hom: () => hom,
    markers_find: () => options.markerMask || 0, markers_homography: () => 0,
    markers_cands: () => cands, markers_find_near: () => 0, markers_near: () => near,
    markers_fit: () => 0, markers_fit_in: () => fitIn, markers_fit_out: () => fitOut,
  };
  new Float64Array(memory.buffer, found, 8).set([100, 80, 540, 80, 540, 280, 100, 280]);
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(message) { this.sent.push(JSON.parse(message)); }
    open() { this.readyState = 1; this.onopen(); }
    receive(message) { this.onmessage({data: JSON.stringify(message)}); }
    close(code = 1006) { this.readyState = 3; this.onclose({code}); }
  }
  const hud = {
    NAV: {}, setCalm() {}, setTrack() {}, setWorld() {}, setSize() {}, drawScreen() {}, drawARView() { return {horizon: [[0, 100], [100, 100]]}; },
    drawTracker() {}, drawFlagChip() {}, drawNav() {}, wrapS: s => ((s % 1000) + 1000) % 1000,
    dSigned: (a, b) => { const d = ((b - a) % 1000 + 1000) % 1000; return d > 500 ? d - 1000 : d; },
  };
  const context = {
    console, document, navigator: {userAgent: 'test', platform: 'test', maxTouchPoints: 0,
      mediaDevices: {getUserMedia: async () => { if (options.cameraError) throw new Error('Camera refused'); return {getTracks: () => [{stop() {}}]}; }},
      wakeLock: {request: async () => ({release: async () => {}})},
    },
    location: {search: '?k=test-pair', protocol: 'https:', host: 'example.test'},
    localStorage, sessionStorage: localStorage, performance: {now: () => now}, screen: {orientation: {angle: 90, lock: async () => {}}},
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, isSecureContext: true,
    URLSearchParams, Uint8Array, Uint8ClampedArray, Float64Array, ArrayBuffer, WebSocket: Socket,
    WebAssembly: {instantiate: async () => { if (options.wasmError) throw new Error('Invalid WebAssembly'); return {instance: {exports: phx}}; }},
    fetch: async () => ({ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0)}),
    makeHUD: () => hud, addEventListener: on,
    requestAnimationFrame(callback) { const id = ++nextRaf; rafs.set(id, callback); return id; },
    cancelAnimationFrame(id) { rafs.delete(id); },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, delay, repeat: false}); return id; },
    setInterval(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, delay, repeat: true}); return id; },
    clearTimeout(id) { timers.delete(id); }, clearInterval(id) { timers.delete(id); },
  };
  context.window = context;
  vm.createContext(context);
  const helper = path.join(__dirname, '../public/js/sim-calibration.js');
  vm.runInContext(fs.readFileSync(helper, 'utf8'), context, {filename: 'sim-calibration.js'});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/wheel.js'), 'utf8'), context, {filename: 'wheel.js'});
  return {
    context, element, document, sockets, texts, timers,
    async click(id) { await element(id).onclick(); },
    async flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); },
    frame(time = now + 40, videoTime = time / 1000) {
      now = time; element('cam').currentTime = videoTime;
      const pendingVideo = [...videoFrames.values()]; videoFrames.clear();
      pendingVideo.forEach(callback => callback(now, {mediaTime: now / 1000, expectedDisplayTime: now, presentedFrames: now, captureTime: now - 90}));
      const pending = [...rafs.values()]; rafs.clear(); pending.forEach(callback => callback(now));
    },
    runTimeout(delay) { for (const [id, timer] of [...timers]) if (!timer.repeat && timer.delay === delay) { timers.delete(id); timer.callback(); } },
    interval(delay) { for (const timer of [...timers.values()]) if (timer.repeat && timer.delay === delay) timer.callback(); },
  };
}

function hasModes(socket, ar, sim) {
  return socket.sent.some(message => message.t === 'hello' && message.ar === ar && message.sim === sim);
}
function track(src = 'game-a', trackRev = 1) { return {t: 'track', src, trackRev}; }
function state(overrides = {}) {
  return {t: 'w', src: 'game-a', trackRev: 1, worldRev: 1, tw: 1000, tm: 1,
    p: [100, 0, 0, 0, 0, 10, 10, 0, 0, 0, 1, 4000, 0, 0], tr: [], hz: [],
    cm: [0, 1, 0, 0, 0, 0, 1], scr: [1280, 720], mk: [46, 46, 1234, 46, 1234, 674, 46, 674],
    fov: 60, vis: 100, a: 0, ni: -1, dn: 200, z: 1, ...overrides};
}
function checkProjection() {
  const THREE = require('../public/vendor/three.min.js');
  const context = {window: {}};
  vm.runInNewContext(require('./hud.js')(), context);
  const hud = context.window.makeHUD(), N = 1000;
  hud.setTrack({N, L: N, DS: 1, PX: Array(N).fill(0), PZ: Array.from({length: N}, (_, i) => -i),
    TX: Array(N).fill(0), TZ: Array(N).fill(-1), H: Array(N).fill(0), SL: Array(N).fill(0), C: []});
  for (const [width, height, fov, angles] of [[1280, 720, 60, [0, 0, 0]], [720, 1280, 75, [.1, -.15, .07]], [1536, 864, 52, [-.1, .15, -.08]]]) {
    const camera = new THREE.PerspectiveCamera(fov, width / height, .04, 4000);
    camera.position.set(0, 1, 5); camera.quaternion.setFromEuler(new THREE.Euler(...angles)); camera.updateMatrixWorld();
    // Deliberately non-unit received quaternion models serialization roundoff.
    const cm = [...camera.position.toArray(), ...camera.quaternion.toArray().map(v => v * 1.0005)];
    const expected = new THREE.Vector3(-6.6, 0, -1).project(camera), points = [];
    const drawing = new Proxy({moveTo(x, y) { points.push([x, y]); }}, {get(target, key) { return key in target ? target[key] : () => {}; }});
    const world = {player: {s: 0}, cm, fov, opts: {hud: false}};
    hud.setSize(width, height); hud.setWorld(world); hud.drawScreen(drawing, world, 0, 0, true);
    assert(points.length, 'HUD draws the first track barrier');
    const error = Math.hypot(points[0][0] - (expected.x * .5 + .5) * width, points[0][1] - (-expected.y * .5 + .5) * height);
    assert(error < 1e-8, `Phone HUD projection matches Three.js across viewport/FOV/pose (error ${error})`);
  }
}

async function main() {
  checkProjection();
  const app = fixture();
  await app.flush();
  app.sockets[0].open();
  await app.click('bAR');
  await app.click('bSim');
  assert.equal(app.element('bSim').getAttribute('aria-pressed'), 'true');
  app.sockets[0].close();
  app.runTimeout(1000);
  const reconnected = app.sockets.at(-1);
  reconnected.open();
  assert(hasModes(reconnected, true, true), 'WebSocket reconnect restores both AR and SIM roles');
  reconnected.sent.length = 0;
  reconnected.receive({t: 'games', n: 1});
  assert(hasModes(reconnected, true, true), 'Game reconnect restores both AR and SIM roles');

  const tracker = app.context.__simar.tracker;
  const corners = [[100, 80], [540, 80], [540, 280], [100, 280]];
  tracker.update(15, corners, 1000); tracker.update(15, corners, 1010);
  assert(tracker.ready(1010));
  await app.click('bCal');
  assert(!tracker.ready(1010), 'SIM recalibration discards previous marker lock');
  assert.equal(app.element('bCal').getAttribute('aria-pressed'), 'false', 'SIM recalibration does not enter manual horizon calibration');

  const reload = fixture();
  await reload.flush();
  const socket = reload.sockets[0]; socket.open();
  socket.receive(track()); socket.receive(state()); reload.frame();
  assert.equal(reload.context.__view.player.s, 100);
  // A track echo must retain snapshots; a fresh game source must replace both geometry and timing.
  socket.receive(track()); reload.frame(1100);
  assert(reload.context.__view.player.s >= 100);
  socket.receive(track('game-b', 2));
  socket.receive(state({src: 'game-b', trackRev: 2, worldRev: 1, tw: 50, p: [400, 0, 0, 0, 0, 0]}));
  socket.receive(state({src: 'game-a', p: [900, 0, 0, 0, 0, 0]}));
  reload.frame(1140);
  assert.equal(reload.context.__view.player.s, 400, 'Reload discards old source state and clock offset');
  socket.receive(state({src: 'game-b', trackRev: 2, worldRev: 2, tw: 100, p: [700, 0, 0, 0, 0, 0]}));
  reload.frame(1180);
  assert.equal(reload.context.__view.player.s, 700, 'Restart does not interpolate across world revisions');

  const detection = {markerMask: 15}, acquired = fixture(detection);
  await acquired.flush(); acquired.sockets[0].open();
  acquired.sockets[0].receive(track()); acquired.sockets[0].receive(state());
  await acquired.click('bAR'); await acquired.click('bSim');
  acquired.frame(1040, 1);
  assert(!acquired.context.__simar.tracker.ready(1040), 'One complete camera frame is insufficient to lock');
  acquired.frame(1080, 1);
  assert(!acquired.context.__simar.tracker.ready(1080), 'Repeated display of the same video frame cannot complete acquisition');
  acquired.frame(1120, 1.08);
  assert(acquired.context.__simar.tracker.ready(1120), 'Two distinct complete camera frames acquire a lock');
  detection.markerMask = 7; acquired.frame(1160, 1.12);
  assert(!acquired.context.__simar.tracker.ready(1160), 'Losing a marker immediately clears the lock');
  acquired.element('cam').videoWidth = 1000; acquired.element('cam').videoHeight = 1000;
  acquired.frame(1200, 1.16);
  assert(acquired.context.__simar.grab.width * acquired.context.__simar.grab.height <= 640 * 480, 'Square video capture fits the detector buffer');

  const autoDet = {markerMask: 15}, auto = fixture(autoDet);
  await auto.flush(); auto.sockets[0].open();
  auto.sockets[0].receive(track()); auto.sockets[0].receive(state());
  await auto.click('bAR');
  auto.frame(1200, 1); auto.frame(1400, 1.08);
  assert(auto.document.body.classList.contains('sim'), 'AR switches to the SIM overlay by itself when the dots are found');
  autoDet.markerMask = 0;
  for (let t = 1500, v = 1.2; t <= 3600; t += 150, v += 0.05) auto.frame(t, v);
  assert(!auto.document.body.classList.contains('sim'), 'Losing the dots for 1.5 s returns to plain AR');

  const failed = fixture({wasmError: true});
  await failed.flush(); failed.sockets[0].open();
  failed.sockets[0].receive(track()); failed.sockets[0].receive(state());
  await failed.click('bAR'); await failed.click('bSim'); failed.frame();
  assert(failed.context.__simar.error, 'WASM failure is retained');
  assert(failed.texts.some(text => text === failed.context.__simar.error), 'WASM failure is shown in SIM view');

  const refused = fixture({cameraError: true});
  await refused.flush(); refused.sockets[0].open();
  refused.sockets[0].receive(track()); refused.sockets[0].receive(state());
  await refused.click('bAR'); refused.interval(500);
  assert.equal(refused.element('hudwait').hidden, false, 'Status refresh keeps camera errors visible');
  assert.match(refused.element('hudwait').textContent, /Camera access/);

  console.log('wheel runtime checks passed');
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {fixture};
