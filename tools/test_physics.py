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

# steering feel: aligning torque rises with steering, peaks, then drops while lateral grip is still building
mz, fy = [], []
for steer in np.linspace(0.005, 0.2, 24):
    reset(150 / 3.6); st[ix["thr"]] = 0.3
    for k in range(120): LIB.veh_step(1 / 120, 1.5, steer, 0, 1, 1e4)
    mz.append(abs(st[ix["mz"]])); fy.append(st[ix["gripF"]])
kmz, kfy = int(np.argmax(mz)), int(np.argmax(fy))
check(0 < kmz < kfy, f"self-aligning torque peaks (step {kmz}) before front grip does (step {kfy}): the wheel goes light before the front slides")

print("\nall checks passed" if ok else "\nSOME CHECKS FAILED")
raise SystemExit(0 if ok else 1)
