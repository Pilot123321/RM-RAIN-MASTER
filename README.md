# Look-Ahead Radar

A helmet-visor HUD concept for F1 that uses the position data every car already sends to
show danger in the next two or three corners: stopped cars, recovery vehicles, marshals and
cars hidden by spray, a wall or a crest. Paired with a visor light that says "danger, now"
without the driver looking.

This repo is a playable demo: a 3D wet street circuit at night where you drive with the HUD
on or off, plus an Android phone that works as the steering wheel.

### What's in it

- **Visor HUD**: light-only (screen-blended) outlines, a perspective road ribbon with cars
  to scale, wheel-to-wheel gaps, hazard warnings, lane guidance and a visor light.
- **Scenarios**: free drive with traffic (press X to hide a hazard past the next blind corner),
  plus three situations modelled on Paletti 1982, Pryce 1977 and Bianchi 2014 / Gasly 2022.
- **Circuit builder**: upload a map or photo of a circuit, or draw one, and the track, 3D
  street and HUD are rebuilt from it.
- **Phone wheel**: tilt an Android phone to steer, two big buttons for gas and brake, and the
  visor HUD mirrored on the phone screen.

### Run it

Requires Node.js 18+.

    npm install
    npm start

- Game on the computer: http://localhost:8080
- Phone over Wi-Fi: scan the QR code in the "Phone wheel" panel. Accept the self-signed
  certificate warning once (the gyro needs https). Some campus and office networks block
  devices from reaching each other; use a phone hotspot or USB instead.
- Phone over USB: enable USB debugging, plug in, open http://localhost:8080/wheel on the
  phone. The server runs `adb reverse` automatically.

Keyboard: W/↑ throttle, S/↓/Space brake, A/D steer, X drop hazard, C camera, N HUD size,
+/- HUD range, Esc stop.

### Files

- `server.js`: static server, WebSocket relay between phone and game, QR codes, self-signed cert, adb reverse
- `public/game.html`: the simulator and HUD (three.js)
- `public/wheel.html`: the phone steering-wheel controller

The simulation is a simplified model for demonstrating the idea, not a reconstruction of real accidents.

### Contributing

Friends with collaborator access can push branches here directly; everyone else can fork and
open a pull request. Keep `certs/` out of commits (it holds the local HTTPS key; `.gitignore`
already excludes it).
