"""Checks the C physics core against independent numpy reference models and against real-world figures.

    .venv/bin/python tools/test_physics.py            # asserts + a short report

Radar: the link budget is recomputed here from the textbook radar equation and must match the C to 1e-9, and
detection ranges must land where long-range 77 GHz sensors do (~250 m for a car in the dry, ~100 m for a person).
Spray: a reference mist droplet in the wake is integrated with RK4 as a sanity check of the wake model; the C
plume must climb with speed to 5-10 m at 200-300 km/h. Vehicle: top speed, braking and cornering in F1 ranges.
"""
import math
import numpy as np
from physics import LIB, VEH_FIELDS

ok = True
def check(cond, msg):
    global ok
    print(("  ok   " if cond else "  FAIL ") + msg)
    ok &= bool(cond)

# ---------------- radar ----------------
print("Radar (77 GHz FMCW)")
F0, PT, LSYS, NF, TF, B, PFA, HR, GAM = 76.5e9, 0.016, 10 ** 1.5, 10 ** 1.4, 0.005, 600e6, 1e-6, 0.35, -0.65
LAM = 3e8 / F0
K = PT * LAM ** 2 / ((4 * np.pi) ** 3 * LSYS * 1.380649e-23 * 290 * NF / TF)
G_FAR, HALF, BWA, EL, DR = 10 ** 2.5, np.radians(9), np.radians(2.2), np.radians(5), 3e8 / (2 * B)

def rain_db(rain):                         # ITU-R P.838 form, k≈1, α≈0.72 at 77 GHz, dB/km one way
    rr = 50 * rain ** 2 + 8 * rain
    return rr ** 0.72 if rr > 0 else 0.0

def two_ray(R, hts):
    ph = 4 * np.pi * HR * np.asarray(hts) / (LAM * R)
    F = np.abs(1 + GAM * np.exp(-1j * ph)) ** 2
    return np.mean(F ** 2)

def sinr_ref(r, az, sigma, hts, loss_db, rain):
    g = G_FAR * math.exp(-0.6925 * (az / HALF) ** 2)
    rad = 10 ** (-(4 * rain) / 10)
    S = K * g * g * sigma * two_ray(r, hts) * rad * 10 ** (-(loss_db + 2 * rain_db(rain) * r / 1000) / 10) / r ** 4
    eta = 3.6e-6 * (50 * rain ** 2 + 8 * rain)
    C = K * g * g * eta * (r * r * BWA * EL * DR * np.pi / 4) * rad * 10 ** (-(2 * rain_db(rain) * r / 1000) / 10) / r ** 4
    return S / (1 + C)

worst = 0
for r in [20, 60, 120, 180, 240]:
    for rain in [0, 0.5, 1]:
        for az in [0, 0.05, -0.12]:
            c = LIB.radar_sinr(r, az, 10, 0.25, 0.5, 0.8, 1.5, rain)
            if LIB.radar_out()[0] != 0: continue
            ref = sinr_ref(r, az, 10, [0.25, 0.5, 0.8], 1.5, rain)
            worst = max(worst, abs(c - ref) / ref)
check(worst < 1e-9, f"C link budget matches the numpy radar equation (max rel. error {worst:.1e})")

def range_pd(sigma, hts, rain, pd=0.9):
    need = math.log(PFA) / math.log(pd) - 1
    for r in np.arange(300, 5, -1.0):
        if LIB.radar_sinr(r, 0, sigma, *hts, 0, rain) >= need and LIB.radar_out()[0] >= 0: return r
    return 0

car_dry, car_wet, car_storm = (range_pd(10, (0.25, 0.5, 0.8), x) for x in (0, 0.6, 1))
person = range_pd(0.7, (0.5, 1.0, 1.5), 0.6)
print(f"       Pd 0.9 range, 10 m² car: dry {car_dry:.0f} m, rain 60% {car_wet:.0f} m, rain 100% {car_storm:.0f} m; marshal (0.7 m², 60%) {person:.0f} m")
check(200 <= car_dry <= 280, "a car is seen at 200-280 m in the dry (long-range radar datasheets: ~250 m)")
check(car_storm < car_wet < car_dry, "rain shortens the range")
check(60 <= person <= 140, "a person is seen at 60-140 m in rain (typical pedestrian range ~100 m)")
check(abs(LIB.radar_range90(0) - min(car_dry, 250)) < 20, "radar_range90 agrees with the brute-force search")
rb = 4 * HR * 0.5 / LAM
far = LIB.radar_two_ray(rb * 10, 0.5, 0.5, 0.5)
check(far < 0.1, f"road multipath: {10*math.log10(far):.1f} dB at 10× the break range {rb:.0f} m (returns fall off faster than R⁻⁴)")

# tracker: a car 120 m ahead closing at 20 m/s is confirmed within 5 scans and its speed estimated
LIB.radar_seed(7)
tx, tz, dt, conf, est = 0.0, 120.0, 1 / 15, False, None
for k in range(30):
    tz -= 20 * dt
    LIB.radar_begin()
    LIB.radar_return(tz, 0.0, -20.0, 10, 0.25, 0.5, 0.8, 0, 0.3, 1, 0)
    LIB.radar_resolve(0, 0, 0, 1, 0, 0)
    n = LIB.radar_track(dt, 0, 0, 0, 0)
    T = LIB.radar_tracks()
    for i in range(n):
        if T[i * 12 + 5] > 0: conf = conf or k < 5; est = (T[i * 12 + 2], T[i * 12 + 4])
check(conf, "tracker confirms the car within 5 scans")
check(est is not None and abs(est[1] + 20) < 1.0 and abs(est[0] - tz) < 1.0, f"track position/speed within 1 m, 1 m/s (z {est[0]:.1f} vs {tz:.1f}, vz {est[1]:.2f})")

# ---------------- spray ----------------
print("Spray")
# one mist droplet (d = 60 µm) in the wake of a car at 250 km/h: numpy RK4 of dv/dt = (u - v)/τ + g
v_car, d = 250 / 3.6, 60e-6
vt = LIB.spray_vt(d); tau = vt / 9.81; w0 = 0.09 * v_car
def rhs(t, y):
    uy = w0 * math.exp(-t / 1.4)
    return np.array([y[1], (uy - y[1]) / tau - 9.81])
y, t, h, top = np.array([0.0, 0.0]), 0.0, 1e-4, 0.0
while t < 3.0:
    k1 = rhs(t, y); k2 = rhs(t + h / 2, y + h / 2 * k1); k3 = rhs(t + h / 2, y + h / 2 * k2); k4 = rhs(t + h, y + h * k3)
    y = y + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4); t += h; top = max(top, y[0])
check(0.75 < top / (w0 * 1.4) < 1.0, f"reference mist droplet rises {top:.1f} m, just under the upwash integral w0·T = {w0*1.4:.1f} m (settling + lag)")
check(abs(LIB.spray_vt(1e-3) - 3.9) < 0.6 and abs(LIB.spray_vt(1e-4) - 0.3) < 0.1, "terminal velocities: 1 mm ≈ 4 m/s, 0.1 mm ≈ 0.3 m/s (Gunn & Kinzer)")

heights = {}
for kmh in [100, 150, 200, 250, 300]:
    LIB.spray_clear(); v = kmh / 3.6; z = 0.0
    for k in range(int(3.0 / 0.016)):
        z += v * 0.016
        for side in (-0.8, 0.8):
            LIB.spray_emit(6, side, 0.3, z - 1.9, 0.0, v, 0.0)
        LIB.spray_update(0.016, 0.8)
    heights[kmh] = LIB.spray_height_q(0.95)
print("       95th-percentile mist height: " + ", ".join(f"{k} km/h {h:.1f} m" for k, h in heights.items()))
hs = list(heights.values())
check(all(b > a for a, b in zip(hs, hs[1:])), "the plume gets taller the faster the car goes")
check(all(5 <= heights[k] <= 10.5 for k in (200, 250, 300)), "5-10 m of spray at 200-300 km/h")

# ---------------- vehicle ----------------
print("Vehicle")
N = 4000
curv = LIB.veh_curv()
for i in range(N): curv[i] = 0.0
LIB.veh_set_track(N, 2.0)
st = LIB.veh_state(); ix = {n: i for i, n in enumerate(VEH_FIELDS)}
def reset(v):
    for i in range(len(VEH_FIELDS)): st[i] = 0.0
    st[ix["vx"]] = v; LIB.veh_reset()
reset(10); st[ix["thr"]] = 1
for k in range(60 * 120): LIB.veh_step(1 / 120, 1.5, 0, 1, 1, 6.6)
check(300 <= st[ix["v"]] * 3.6 <= 360, f"top speed {st[ix['v']]*3.6:.0f} km/h (F1: ~320-350)")
reset(300 / 3.6); st[ix["brk"]] = 1; x0 = st[ix["s"]]; st[ix["v"]] = 300 / 3.6
while st[ix["v"]] > 100 / 3.6: LIB.veh_step(1 / 120, 1.5, 0, 1, 1, 6.6)
dist = st[ix["s"]] - x0
check(60 <= dist <= 140, f"300→100 km/h braking in {dist:.0f} m (F1 dry: ~80-110 m)")
ay = 0
for steer in [0.02, 0.04, 0.06, 0.08, 0.12]:          # sweep the steering until the tyres saturate
    reset(250 / 3.6); st[ix["thr"]] = 0.5
    for k in range(120 * 2):
        LIB.veh_step(1 / 120, 1.5, steer, 1, 1, 1e4)
        ay = max(ay, abs(st[ix["ay"]]))
check(2.5 <= ay / 9.81 <= 5.5, f"peak lateral {ay/9.81:.1f} g at 250 km/h (real F1 3.5-5 g; this tyre model runs a little under)")

# aquaplaning: deeper water brings the onset down; in a 1 mm film nothing happens at race speed
def aqua_at(kmh, mm):
    LIB.veh_set_water(mm); reset(kmh / 3.6); st[ix["thr"]] = 0.5
    for k in range(12): LIB.veh_step(1 / 120, 1.2, 0.0, 1, 1, 1e4)
    return st[ix["aqua"]]
a1, a4, a4s = aqua_at(290, 1.0), aqua_at(290, 4.0), aqua_at(120, 4.0)
check(a1 < 0.05 and a4 > 0.3 and a4s < 0.05, f"aquaplaning at 290 km/h: {a1:.2f} in a 1 mm film, {a4:.2f} in 4 mm; at 120 km/h in 4 mm: {a4s:.2f}")
def brake_dist(mm):
    LIB.veh_set_water(mm); reset(280 / 3.6); st[ix["brk"]] = 1; st[ix["v"]] = 280 / 3.6; x0 = st[ix["s"]]
    while st[ix["v"]] > 100 / 3.6: LIB.veh_step(1 / 120, 1.1, 0, 1, 1, 6.6)
    return st[ix["s"]] - x0
d0, d4 = brake_dist(0), brake_dist(4.0)
check(d4 > d0 * 1.05, f"wet braking 280→100 km/h: {d0:.0f} m on a thin film, {d4:.0f} m through 4 mm of standing water")
LIB.veh_set_water(0)

# front-tyre spray at 250 km/h: tread pick-up climbs a few metres beside the car, the bow wave stays low
LIB.spray_clear(); v = 250 / 3.6; z = 0.0
for k in range(int(2.0 / 0.016)):
    z += v * 0.016
    for side in (-1, 1): LIB.spray_emit_tyre(8, side * 0.8, 0.3, z + 1.9, 0.0, v, side, 0.0, 0.0)
    LIB.spray_update(0.016, 0.8)
fh = LIB.spray_height_q(0.95)
check(1.0 <= fh <= 6.0, f"front-tyre mist reaches {fh:.1f} m at 250 km/h (lower than the rear plume)")

# reverse: from a standstill with reverse engaged the car backs up, and tops out at a crawl
reset(0); st[ix["rev"]] = 1; st[ix["thr"]] = 1
for k in range(120 * 4): LIB.veh_step(1 / 120, 1.4, 0, 1, 1, 1e4)
check(-12 < st[ix["vx"]] < -4, f"reverse: {st[ix['vx']]*3.6:.0f} km/h after 4 s on full reverse throttle")
st[ix["rev"]] = 0

# steering feel: aligning torque rises with steering, peaks, then drops while lateral grip is still building
mz, fy = [], []
for steer in np.linspace(0.005, 0.2, 24):
    reset(150 / 3.6); st[ix["thr"]] = 0.3
    for k in range(120): LIB.veh_step(1 / 120, 1.5, steer, 0, 1, 1e4)
    mz.append(abs(st[ix["mz"]])); fy.append(st[ix["gripF"]])
kmz, kfy = int(np.argmax(mz)), int(np.argmax(fy))
check(0 < kmz < kfy, f"self-aligning torque peaks (step {kmz}) before front grip does (step {kfy}): the wheel goes light before the front slides")

# ---------------- track (C++) ----------------
print("Track (C++)")
n = LIB.track_default(); N = LIB.track_build(n)
check(2800 < LIB.track_len() < 3000 and LIB.track_ncorners() == 8, f"default circuit: {LIB.track_len():.0f} m, {LIB.track_ncorners()} corners, {N} samples")
vp = np.ctypeslib.as_array(LIB.track_vprof(), shape=(N,)); lat = np.ctypeslib.as_array(LIB.track_lat(), shape=(N,))
check(vp.min() > 15 and vp.max() <= 83.0 + 1e-9, f"speed profile {vp.min()*3.6:.0f}-{vp.max()*3.6:.0f} km/h")
check(np.abs(lat).max() <= 4.7 + 1e-9, f"racing line stays on the road (max offset {np.abs(lat).max():.2f} m)")
crest = LIB.track_crest()
check(LIB.track_los(crest - 200, 0, 0.95, crest - 150, 0, 0.5) == 1 and LIB.track_los(crest - 120, 0, 0.3, crest + 60, 0, 0.3) == 0,
      "line of sight: clear on the straight, blocked over the crest")
check(LIB.track_water(100, 0, 0) == 0 and LIB.track_water(100, 5.5, 1) > LIB.track_water(100, 5.5, 0.5) > 0, "standing water grows with rain")

# ---------------- screenshot tracer (C++) ----------------
print("Screenshot tracer (C++)")
W = H = 300; img = np.full((H, W, 4), 255, np.uint8)
yy, xx = np.mgrid[0:H, 0:W]; rr = np.hypot((xx - 150) / 1.3, yy - 150)
img[(rr > 88) & (rr < 96)] = (200, 30, 40, 255)                     # an oval lap drawn in red on white
ctypes_buf = np.ctypeslib.as_array(LIB.trace_rgba(), shape=(W * H * 4,)); ctypes_buf[:] = img.reshape(-1)
m = LIB.trace_run(W, H, 0, 0, 0, 0, 60.0)
pts = np.ctypeslib.as_array(LIB.trace_points(), shape=(max(m, 0) * 2,)).reshape(-1, 2) if m > 0 else np.zeros((0, 2))
rad = np.hypot((pts[:, 0] - 150) / 1.3, pts[:, 1] - 150) if m > 0 else np.array([0])
check(m > 100 and LIB.trace_method() == 0 and abs(rad.mean() - 92) < 3, f"traces the oval as a centreline loop ({m} points, mean radius {rad.mean():.1f} px)")
img[:] = 255; ctypes_buf[:] = img.reshape(-1)
check(LIB.trace_run(W, H, 0, 0, 0, 0, 60.0) == -1, "blank image: no track found")

# ---------------- SIM AR calibration dots (C++) ----------------
print("SIM AR markers (C++)")
W, H = 320, 180; fr = np.full((H, W, 4), 20, np.uint8); fr[..., 3] = 255
yy, xx = np.mgrid[0:H, 0:W]
dots = [((30, 25), (240, 20, 20)), ((290, 28), (20, 230, 20)), ((285, 150), (20, 70, 240)), ((35, 152), (235, 20, 235))]
for (cx0, cy0), col in dots:
    fr[(xx - cx0) ** 2 + (yy - cy0) ** 2 <= 110] = (235, 235, 235, 255)  # white ring
    fr[(xx - cx0) ** 2 + (yy - cy0) ** 2 <= 56] = (0, 0, 0, 255)          # black ring
    fr[(xx - cx0) ** 2 + (yy - cy0) ** 2 <= 25] = col + (255,)
fr[90:94, 60:200] = (240, 20, 20, 255)            # a red kerb stripe
fr[60:72, 140:152] = (20, 70, 240, 255)           # a blue TecPro block
np.ctypeslib.as_array(LIB.markers_frame(), shape=(W * H * 4,))[:] = fr.reshape(-1)
mask = LIB.markers_find(W, H); F = np.ctypeslib.as_array(LIB.markers_found(), shape=(8,)).reshape(4, 2)
err = max(np.hypot(F[k][0] - 0.5 - dots[k][0][0], F[k][1] - 0.5 - dots[k][0][1]) for k in range(4))
check(mask == 15 and err < 1.0, f"finds all four dots and ignores a red stripe and a blue block (max centre error {err:.2f} px)")

def detect_markers(frame):
    h, w, _ = frame.shape
    np.ctypeslib.as_array(LIB.markers_frame(), shape=(w * h * 4,))[:] = frame.reshape(-1)
    mask = LIB.markers_find(w, h)
    centres = np.ctypeslib.as_array(LIB.markers_found(), shape=(8,)).reshape(4, 2).copy()
    return mask, centres

# Render the CSS marker proportions (18 px colour, 25 px black, 29 px white) at subpixel resolution.
# A tilted screen makes the rings elliptical; antialiasing leaves the narrow white ring only one pixel wide.
ss = 4
sy, sx = np.mgrid[:H * ss, :W * ss] / ss + 0.5 / ss
centres = np.array([[40.2, 30.3], [279.7, 30.4], [280.1, 149.8], [39.6, 150.1]])
colours = [(255, 20, 20), (20, 240, 20), (20, 70, 255), (240, 20, 240)]
failed_views, max_error = [], 0
for tilt in (1.0, 0.65, 0.5, 0.4):
    for angle in (0, 0.5, 0.9):
        hi = np.full((H * ss, W * ss, 4), 20, np.uint8); hi[..., 3] = 255
        for (px, py), col in zip(centres, colours):
            ex = (sx - px) * np.cos(angle) + (sy - py) * np.sin(angle)
            ey = -(sx - px) * np.sin(angle) + (sy - py) * np.cos(angle)
            radius = (ex / tilt) ** 2 + ey ** 2
            for r, rgb in ((5 * 29 / 18, (255,) * 3), (5 * 25 / 18, (0,) * 3), (5, col)):
                hi[radius <= r * r] = (*rgb, 255)
        low = hi.reshape(H, ss, W, ss, 4).mean(axis=(1, 3)).astype(np.uint8)
        mask, measured = detect_markers(low)
        if mask != 15: failed_views.append((tilt, angle, mask))
        else: max_error = max(max_error, np.linalg.norm(measured - centres, axis=1).max())
check(not failed_views and max_error < 0.65,
      f"finds antialiased CSS dots under tilt and roll (12 views, max error {max_error:.2f} px, failures {failed_views})")

# A full perspective warp changes each marker's scale and shape differently. Generate the image with numpy's
# inverse mapping and compare detections with the independently projected screen centres.
projective = np.array([[0.42, -0.08, 50], [0.07, 0.39, 10], [0.0005, 0.0001, 1]])
screen_centres = np.array([[46, 46], [594, 46], [594, 314], [46, 314]])
source_grid = np.linalg.solve(projective, np.stack([sx.ravel(), sy.ravel(), np.ones(sx.size)]))
source_grid = (source_grid[:2] / source_grid[2]).reshape(2, H * ss, W * ss)
hi = np.full((H * ss, W * ss, 4), 20, np.uint8); hi[..., 3] = 255
for (px, py), col in zip(screen_centres, colours):
    radius = (source_grid[0] - px) ** 2 + (source_grid[1] - py) ** 2
    for r, rgb in ((29, (255,) * 3), (25, (0,) * 3), (18, col)):
        hi[radius <= r * r] = (*rgb, 255)
low = hi.reshape(H, ss, W, ss, 4).mean(axis=(1, 3)).astype(np.uint8)
expected = projective @ np.vstack([screen_centres.T, np.ones(4)])
expected = (expected[:2] / expected[2]).T
mask, measured = detect_markers(low)
perspective_error = np.linalg.norm(measured - expected, axis=1).max()
check(mask == 15 and perspective_error < 0.65,
      f"detects all four dots in a projectively warped screen (max error {perspective_error:.2f} px)")
portrait = np.full((640, 480, 4), 20, np.uint8); portrait[..., 3] = 255
portrait[20:20 + W, 20:20 + H] = np.rot90(low)
square = np.full((512, 512, 4), 20, np.uint8); square[..., 3] = 255
square[20:20 + H, 20:20 + W] = low
check(detect_markers(portrait)[0] == 15 and detect_markers(square)[0] == 15,
      "marker buffer supports portrait and square frames within its pixel capacity")
rejected_rings = []
for ring in ("none", "black", "white", "reversed"):
    scenery = np.full((H, W, 4), 20, np.uint8); scenery[..., 3] = 255
    for (px, py), col in zip(centres, colours):
        radius = (xx - px) ** 2 + (yy - py) ** 2
        if ring == "black": scenery[radius <= 100] = (0, 0, 0, 255)
        if ring == "white": scenery[radius <= 100] = (255, 255, 255, 255)
        if ring == "reversed":
            scenery[radius <= 100] = (0, 0, 0, 255)
            scenery[radius <= 64] = (255, 255, 255, 255)
        scenery[radius <= 25] = (*col, 255)
    rejected_rings.append(detect_markers(scenery)[0] == 0)
check(all(rejected_rings), "coloured discs without the ordered black/white rings are rejected")
blank = np.full((H, W, 4), 20, np.uint8); blank[..., 3] = 255
mask, measured = detect_markers(blank)
check(mask == 0 and np.all(measured == 0), "empty frame clears old marker centres")
check(all(LIB.markers_find(w, h) == 0 for w, h in ((0, 180), (640, 640), (2 ** 30, 16))),
      "invalid and oversized marker dimensions fail without overflowing the frame buffer")

src = [0, 0, 1500, 0, 1500, 857, 0, 857]; dst = [190, 95, 1110, 60, 1150, 650, 150, 610]
solved = LIB.markers_homography(*src, *dst); Hm = np.ctypeslib.as_array(LIB.markers_hom(), shape=(9,)).reshape(3, 3).copy()
mapped = Hm @ np.vstack([np.array(src).reshape(4, 2).T, np.ones(4)])
check(solved == 1 and np.max(np.abs((mapped[:2] / mapped[2]).T - np.array(dst).reshape(4, 2))) < 1e-6,
      "homography maps all four screen corners exactly")
bad_quads = [[1, 1] * 4, [0, 0, 1, 1, 2, 2, 3, 3], [0, 0, 100, 0, 100, 1e-10, 0, 1e-10],
             [0, 0, 100, 100, 100, 0, 0, 100], [0, 0, 100, 0, 40, 40, 0, 100],
             [float("nan"), 0, 100, 0, 100, 100, 0, 100], [float("inf"), 0, 100, 0, 100, 100, 0, 100]]
check(all(LIB.markers_homography(*src, *bad) == 0 and LIB.markers_homography(*bad, *dst) == 0 for bad in bad_quads),
      "homography rejects non-finite, crossed, concave and nearly collapsed screen quads")
flipped = np.array(dst).reshape(4, 2)[[1, 0, 3, 2]].reshape(-1)
check(LIB.markers_homography(*src, *flipped) == 1, "homography accepts a mirrored convex screen")

print("\nall checks passed" if ok else "\nSOME CHECKS FAILED")
raise SystemExit(0 if ok else 1)
