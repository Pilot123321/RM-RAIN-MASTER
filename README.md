# RM

A helmet-visor HUD concept for F1 that uses the position data every car already sends to
show danger in the next two or three corners: stopped cars, recovery vehicles, marshals and
cars hidden by spray, a wall or a crest. Paired with a visor light that says "danger, now"
without the driver looking.

This repo is a playable demo: a floodlit, wet Grand Prix circuit (grandstands, pit building, gravel and
grass run-off, light towers) where you drive with the HUD on or off, plus a phone (iPhone or Android) that works as the
steering wheel.

### What's in it

- **Visor HUD**: light-only (screen-blended) outlines, a perspective road ribbon with cars
  to scale, wheel-to-wheel gaps, hazard warnings, lane guidance and a visor light.
- **Scenarios**: free drive with traffic (press X to hide a hazard past the next blind corner),
  plus three situations modelled on Paletti 1982, Pryce 1977 and Bianchi 2014 / Gasly 2022.
- **Circuit builder**: upload a map or photo of a circuit, or draw one, and the track, 3D
  street and HUD are rebuilt from it.
- **On-board radar**: a simulated 77 GHz radar in the nose, alongside the position feed. It is
  blocked by walls and crests, loses range in rain and spray, and its tracks show on the HUD as teal diamonds.
- **Spray**: every car throws a plume from its rear tyres that grows with speed (about 5 m at 150 km/h and
  10 m at 300 km/h). Following in it blurs your view, puts droplets on the visor, thickens the fog and costs
  downforce (dirty air).
- **Wet track**: the rain setting darkens the asphalt and lays a water film on it; puddles (world-space noise,
  deeper at the edges where the camber drains, thinner on the rubbered racing line) go mirror-smooth and ring with
  rain drops.
- **Car behind**: thin flat flashes on the side a car is closing from, within 50 m.
- **Engine sound**: loops cut from real V8 recordings (a Maserati V8 and the Bentley Speed 8 Le Mans car), pitched
  to the physics rpm and crossfaded by rpm and throttle, with upshift cuts, overrun crackle and the nearest car
  panned with Doppler.
- **Phone wheel**: tilt a phone (iPhone or Android) to steer, gas and brake on the sides. The phone shows the game
  screen's HUD layout with the track edges (no 3D picture). In AR mode (a passenger view: the autopilot drives)
  it uses the camera and the phone's full orientation, smoothed so the overlay holds still. Force feedback comes from the tyres through the vibration motor: impacts, lock-ups, kerbs,
  wheelspin and slides, front scrub, and a steering-weight hum that fades as the front goes light.

- **Layout**: the sim fills the window; Setup, Phone and Circuit open as tabs over it. The game screen stays
  clean (gear and speed); boxes, call signs and the radar live on the phone and in AR, or on the PC with the
  Visor HUD button (V).
- **2D radar**: flat, heading-up proximity radar (like iRacing's) with range rings, call signs, side bars when a car
  is alongside, and yellow/red flag sectors.
- **Flags**: ~200 m marshal sectors go yellow around a hazard and red when it blocks the track or a marshal is
  running across; the autopilot drops to VSC pace through red.
- **Two phones**: one as the wheel, a second as the AR viewer (head yaw tracked). The AR road shows the surface, barriers, centre dashes, kerbs and corner
  chevrons. Phones pair through the key in the QR code; phones over USB need none.
- **SIM AR**: tap AR on the phone and point it at the computer screen. While a phone is in AR the sim shows ten
  coloured calibration dots and a frame-number strip (also the Dots button / K). Every camera frame, the phone finds
  the dots (C++, `physics/markers.cpp`, candidates checked against each other so kerbs and sponsor boards cannot pass
  as dots), fits the screen mapping plus its own lens bend and field of view, reads the frame number (Gray code with
  parity, painted into the WebGL frame) so the HUD is drawn for exactly the frame on screen, and warps the HUD over
  the sim picture; SIM switches on by itself. When the dots are missed for a moment, AR carries on through the sim's
  own camera, aligned from the dots. One **Calibrate** button re-centres and relearns everything.
- **Circuits from screenshots**: drop a screenshot anywhere on the page or paste it (Cmd+V).

### On the web

The simulator runs entirely in the browser (the physics is WebAssembly), so it is deployed on Vercel:
https://rm-racing.vercel.app (`vercel.json`: serves `public/`, `/` opens the game). Phones pair through a WebSocket
relay function (`api/ws.js`) with a private room code in the phone link, so no home IP is ever exposed. The relay
works within one server instance; set `REDIS_URL` (any Redis, e.g. from the Vercel Marketplace) to relay across
instances when many people use the site at once. The local server below still works for Wi-Fi and USB.

### Run it

Requires Node.js 18+. The physics core is prebuilt (`public/physics.wasm`), so this is enough:

    npm install
    npm start

To change the physics you need Python 3 (for the Zig C compiler from pip):

    npm run setup:physics    # .venv with ziglang + numpy
    npm run build:physics    # physics/*.c -> public/physics.wasm (+ build/libphysics for tests)
    npm test                 # build, then check the C against Python reference models

- Game on the computer: http://localhost:8080
- Phone over Wi-Fi: scan the QR code in the "Phone wheel" panel. Accept the self-signed
  certificate warning once (the gyro needs https). Some campus and office networks block
  devices from reaching each other; use a phone hotspot or USB instead.
- Phone over USB: enable USB debugging, plug in, open http://localhost:8080/wheel on the
  phone. The server runs `adb reverse` automatically.

Keyboard: W/↑ throttle, S/↓/Space brake, A/D steer, X drop hazard, C camera, N HUD size,
+/- HUD range, Esc stop.

### Code layout

- `physics/*.c` (C): the car (`vehicle.c`), the 77 GHz radar sensor and tracker (`radar.c`), tyre spray (`spray.c`).
- `physics/*.cpp` (C++): the track (`track.cpp`: smoothing, curvature, corners, elevation, barriers, racing line,
  speed profile, line of sight, standing water) and the screenshot tracer (`trace.cpp`: colour mask, thinning, loop walk).
  C and C++ compile into one WebAssembly module, `public/physics.wasm`, and a native library for the tests.
- `tools/` (Python): `build.py` compiles the core with Zig; `test_physics.py` checks it against numpy reference
  models and real-world figures; `physics.py` is the ctypes binding.
- `public/css/` (CSS): all styling, including the spray-on-visor blur and the car-behind edge glow.
- `public/js/game.js`, `public/js/wheel.js`: scene, driver model, HUD drawing and UI (three.js), talking to the
  core. `public/game.html` and `public/wheel.html` are markup only.

### Radar

`physics/radar.c` works from the radar range equation: 12 dBm output, 25 dBi far beam (±9°) and 16 dBi near
beam (±45°), 14 dB noise figure, 15 dB losses, and 5 ms coherent frames. On top of that it models:

- rain attenuation in the ITU-R P.838 form, plus a wet radome
- rain clutter, and extra loss through spray plumes
- two-ray reflection off the road
- Swerling-1 targets behind a CFAR detector, with detection probability Pd = Pfa^(1/(1+SINR))
- measurement noise that depends on SNR, merging of targets that fall in the same resolution cell, and
  returns from the barriers
- a Kalman tracker

What the radar can reach is decided by the scene: barriers, crests and cars block it. Results: a car at
about 275 m in the dry, 190 m at 60 % rain and 150 m in a downpour; a person at about 110 m in rain.

### Physics

Your car is a dynamic bicycle model in track coordinates (Liniger, Domahidi & Morari 2015) with:
- wheel-speed dynamics per axle: rear-wheel drive through an 8-speed gearbox (engine inertia
  reflected through the gear), brakes on both axles, so wheelspin and lock-ups happen
- combined-slip Magic Formula tyres, "theoretical slip" form (Pacejka, *Tire and Vehicle Dynamics*,
  2012; as used by Velenis, Tsiotras & Lu 2007), with a sliding-friction floor for locked or
  drifting tyres
- tyre load sensitivity, lateral and longitudinal load transfer, aero downforce and drag,
  tyre relaxation length, aquaplaning, slippery wet kerbs
- drift equilibria as in Hindiyeh & Gerdes 2014: power holds the rear slip, countersteer balances it
- assists (on by default): traction control, ABS, stability control. Turn them off to drift.

### Car model

Other cars and your car in the chase view use a real F1 2022 model (`public/assets/f1.glb`),
merged by material at load time and repainted per team. The driver's-eye view uses the
procedural cockpit (`public/f1car.js`). Swap in any glTF you are licensed to use at the same
path; if it faces the wrong way add `public/assets/f1.json` with `{"yaw": 180}`.

### Credits

- F1 2022 car model by Blender458 (https://sketchfab.com/Blender458), CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/), obtained via FetchCFD. Unmodified; scaled and
  recoloured at runtime.
- Asphalt "asphalt_track" and concrete "brushed_concrete" by Poly Haven, CC0
- three.js r128 and its example add-ons, MIT licence (`public/vendor/`)
- Engine sound: loops cut from real V8 recordings (`tools/engine_samples.py`, `public/assets/engine/CREDITS.txt`):
  Maserati GranTurismo S exhaust by lmartins (freesound 465453), CC BY 4.0 (idle, low revs, free revving), and
  Bentley Speed 8 (2003) by Edvvc on Wikimedia Commons, CC BY-SA 3.0 (full load; the derived `load.wav` keeps
  that licence)

### Files

- `server.js`: static server, WebSocket relay between phone and game, QR codes, self-signed cert, adb reverse
- `public/game.html`: the simulator scene, driver model and HUD (three.js); physics in `physics/*.c`
- `public/f1car.js`: the procedural F1 car model
- `public/wheel.html`: the phone steering-wheel controller

The simulation is a simplified model for demonstrating the idea, not a reconstruction of real accidents.

### Contributing

Friends with collaborator access can push branches here directly; everyone else can fork and
open a pull request. Keep `certs/` out of commits (it holds the local HTTPS key; `.gitignore`
already excludes it).
