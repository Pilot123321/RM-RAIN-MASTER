/* Vehicle dynamics: dynamic bicycle model in track coordinates (Liniger, Domahidi & Morari 2015) with
   - wheel-speed dynamics per axle: rear drive through an 8-speed gearbox (engine inertia reflected through the
     gear), brakes on both axles, so wheelspin and lock-ups happen
   - combined-slip Magic Formula tyres in the "theoretical slip" form (Pacejka, Tire and Vehicle Dynamics 2012,
     ch. 4; as used by Velenis, Tsiotras & Lu 2007), with a sliding-friction floor
   - tyre load sensitivity, lateral and longitudinal load transfer, aero downforce and drag, tyre relaxation
   - drift equilibria as in Hindiyeh & Gerdes 2014; traction control, ABS and stability control as assists
   - barrier contact: rigid-body impulse with restitution and Coulomb friction at the car's corners
   The driver model (throttle/brake/steering filters, steering target) stays in JavaScript; this file integrates
   the physics between two frames. */
#include "physics.h"

/* car parameters (2022-rules F1 car, wet setup) */
#define M 798.0
#define IZ 1150.0
#define LF 1.95
#define LR 1.65
#define HCG 0.3
#define CLA 4.4
#define CDA 1.35
#define AEROF 0.42
#define PMAX 760e3
#define FBRAKE (5.5 * 798 * 9.81)
#define BB 0.57
#define BF 9.0
#define BR 11.0
#define CC 1.9
#define EE 0.97
#define REARMU 1.08
#define DMAX 0.34
#define RHO 1.2
#define RW 0.36
#define WALL_E 0.32
#define WALL_MU 0.45

/* B·s at the Magic Formula peak for C = 1.9, E = 0.97: C·atan(Bs - E(Bs - atan Bs)) = π/2 gives Bs ≈ 1.8 */
#define BS_PEAK 1.8
#define TRAIL0 0.04   /* pneumatic trail at small slip, m */
static const double GEARS[8] = {18.1, 14.98, 12.4, 10.27, 8.5, 7.04, 5.83, 4.81};
#define GREV 16.0      /* reverse: overall ratio, drive fades out above ~8 m/s */
static const double CORNERS4[4][2] = {{2.7, 0.95}, {2.7, -0.95}, {-2.55, 0.95}, {-2.55, -0.95}};

/* state shared with JavaScript: index order must match VEH_FIELDS in game.html */
enum { S_S, S_LAT, S_PSI, S_VX, S_VY, S_R, S_WF, S_WR, S_KF, S_KR, S_AF, S_AR, S_FYFS, S_FYRS, S_AX, S_AY,
       S_THR, S_BRK, S_DELTA, S_GEAR, S_CUT, S_RPM, S_HITV, S_LATV, S_V, S_SLIDING, S_BETA,
       S_SATF, S_SATR, S_MZ, S_GRIPF, S_GRIPR, S_AQUA, S_REV, S_COUNT };
static double st[S_COUNT];
static double curv[16384];
static int KN = 1;
static double KDS = 1, KL = 1;
static double water_mm = 0;   /* standing water under the car, set by the caller each frame */

/* Aquaplaning. A tyre has to push water out of its footprint; above a critical speed it cannot, and a wedge of
   water lifts the contact patch. For smooth tyres Horne & Dreher's law puts the onset at v ~ sqrt(pressure); a
   grooved wet evacuates water through its tread, so the onset here scales as 1/sqrt(film depth): about 380 km/h
   in a 1 mm film, 220 km/h in 3 mm, 170 km/h in 5 mm. Grip then fades over the next ~50 % of that speed. */
static double aqua_loss(double v, double depth) {
  if (depth < 0.15) return 0;
  double vc = 105.0 * sqrt(1.0 / depth);
  return clampd((v - 0.8 * vc) / (0.5 * vc), 0, 1);
}
EXPORT(veh_set_water) void veh_set_water(double mm) { water_mm = mm > 0 ? mm : 0; }

EXPORT(veh_state) double *veh_state(void) { return st; }
EXPORT(veh_curv) double *veh_curv(void) { return curv; }
EXPORT(veh_set_track) void veh_set_track(int n, double ds) { KN = n; KDS = ds; KL = n * ds; }

static double wrap_s(double s) { s = fmod(s, KL); return s < 0 ? s + KL : s; }
static double kappa(double s) {
  double x = wrap_s(s) / KDS; int i = (int)x % KN, j = (i + 1) % KN; double f = x - floor(x);
  return curv[i] + (curv[j] - curv[i]) * f;
}
static double rpm_of(double v, int g) { double r = v / (2 * PI * RW) * 60 * GEARS[g]; return r > 4200 ? r : 4200; }
static double torque_at(double rpm) { double x = (rpm - 10800) / 7200, t = 560 * (1 - x * x); return t > 260 ? t : 260; }
/* axle grip with load sensitivity: the loaded outside tyre gains grip less than in proportion */
static double mu_load(double F, double mu0) { double k = 1 - 0.12 * (F / 2400 - 1); return mu0 * (k > 0.6 ? k : 0.6); }
static double axle_grip(double Fz, double dF, double mu0) {
  double a = Fz / 2 + fabs(dF), b = Fz / 2 - fabs(dF); if (b < 0) b = 0;
  return mu_load(a, mu0) * a + mu_load(b, mu0) * b;
}
/* combined slip, theoretical-slip form: sx = k/(1+k), sy = tan(a)/(1+k), |F| = MF(|s|) shared along (sx, sy) */
static void combined_slip(double k, double a, double D, double B, double *Fx, double *Fy, double *sat) {
  double k1 = 1 + k > 0.08 ? 1 + k : 0.08, sx = k / k1, sy = tan(clampd(a, -1.4, 1.4)) / k1, sm = hypot(sx, sy);
  *sat = B * sm / BS_PEAK;
  if (sm < 1e-7) { *Fx = *Fy = 0; return; }
  double Bs = B * sm, F = D * sin(CC * atan(Bs - EE * (Bs - atan(Bs))));
  if (Bs > 2.2 && F < 0.74 * D) F = 0.74 * D;  /* sliding rubber keeps ~3/4 of peak grip */
  *Fx = F * sx / sm; *Fy = F * sy / sm;
}
/* barrier impulse: j = (1+e) vn / (1/m + (r x n)^2 / Iz), friction |jt| <= mu_w j, at the deepest corner */
static void wall_contact(double wall) {
  double cs = cos(st[S_PSI]), sn = sin(st[S_PSI]);
  double Vs = st[S_VX] * cs - st[S_VY] * sn, Vn = st[S_VX] * sn + st[S_VY] * cs, r = st[S_R], hit = 0;
  for (int side = 1; side >= -1; side -= 2) {
    double pen = 0, ps = 0, pn = 0; int found = 0;
    for (int c = 0; c < 4; c++) {
      double a = CORNERS4[c][0], b = CORNERS4[c][1], cps = a * cs - b * sn, cpn = a * sn + b * cs, lat = st[S_LAT] + cpn;
      double over = side > 0 ? lat - wall : -wall - lat;
      if (over > pen) { pen = over; ps = cps; pn = cpn; found = 1; }
    }
    if (!found) continue;
    double nrm = side;
    st[S_LAT] -= nrm * pen;
    double vn = (Vn + r * ps) * nrm;
    if (vn <= 0) continue;
    double rxn = ps * nrm, k = 1 / M + rxn * rxn / IZ, j = (1 + WALL_E) * vn / k;
    Vn -= nrm * j / M; r -= rxn * j / IZ;
    double vt = Vs - r * pn, kt = 1 / M + pn * pn / IZ, jt = -sgn(vt) * fmin(WALL_MU * j, fabs(vt) / kt);
    Vs += jt / M; r += (-pn) * jt / IZ;
    if (vn > hit) hit = vn;
  }
  if (hit > 0) {
    st[S_VX] = Vs * cs + Vn * sn; st[S_VY] = -Vs * sn + Vn * cs; st[S_R] = r;
    if (hit > st[S_HITV]) st[S_HITV] = hit;
    if (st[S_REV] < 0.5) { double wmax = st[S_VX] / RW + 2; if (st[S_WF] > wmax) st[S_WF] = wmax; if (st[S_WF] < 0) st[S_WF] = 0; }
  }
}

/* put the wheels at road speed and pick the gear for the current speed (new car / reset) */
EXPORT(veh_reset) void veh_reset(void) {
  st[S_WF] = st[S_WR] = st[S_VX] / RW; st[S_KF] = st[S_KR] = st[S_AF] = st[S_AR] = 0;
  int g = 0; while (g < 7 && rpm_of(st[S_VX], g) > 11000) g++;
  st[S_GEAR] = g; st[S_CUT] = 0;
}

/* one frame: gearbox, steering rate limit, then adaptive substeps of the stiff wheel-slip dynamics */
EXPORT(veh_step) void veh_step(double dt, double mu, double dTarget, int aids, double aeroK, double wall) {
  const double L = LF + LR;
  int gear = (int)st[S_GEAR], rev = st[S_REV] > 0.5;
  st[S_RPM] = fmax(4200, fabs(st[S_WR]) * 60 / (2 * PI) * (rev ? GREV : GEARS[gear]));
  if (rev) { gear = 0; st[S_CUT] = 0; }
  else if (st[S_CUT] > 0) st[S_CUT] -= dt;
  else if (st[S_RPM] > 11800 && gear < 7) { gear++; st[S_CUT] = 0.045; }
  else if (st[S_RPM] < 7300 && gear > 0) { gear--; st[S_CUT] = 0.03; }
  st[S_GEAR] = gear;
  double rate = (aids ? 2.2 : 3.5) * dt;
  st[S_DELTA] += clampd(dTarget - st[S_DELTA], -rate, rate);
  double dl = st[S_DELTA], cd = cos(dl), sd = sin(dl), Gr = rev ? GREV : GEARS[gear];
  double Iwf = 2.4, Iwr = 2.6 + 0.045 * Gr * Gr;
  double Dest = mu * (3900 + 0.25 * RHO * CLA * aeroK * st[S_VX] * st[S_VX]);
  double stiff = RW * RW * BR * CC * Dest / (Iwf * fmax(fabs(st[S_VX]), 3));
  int n = (int)clampd(ceil(dt * stiff * 1.4), 4, 48); double h = dt / n;
  for (int k = 0; k < n; k++) {
    double kap = kappa(st[S_S]), vx = st[S_VX], vy = st[S_VY], r = st[S_R], v2 = vx * vx + vy * vy;
    double down = 0.5 * RHO * CLA * aeroK * v2, drag = 0.5 * RHO * CDA * v2 * sgn(vx) + (fabs(vx) > 0.1 ? 220 * sgn(vx) : 0);
    double Fzf = fmax(500, M * G0 * LR / L + down * AEROF - M * st[S_AX] * HCG / L);
    double Fzr = fmax(500, M * G0 * LF / L + down * (1 - AEROF) + M * st[S_AX] * HCG / L);
    /* the fronts meet the full water film; the rears run in the channels the fronts have partly cleared */
    double aqF = aqua_loss(fabs(vx), water_mm), aqR = aqua_loss(fabs(vx), water_mm * 0.55);
    st[S_AQUA] = aqF;
    double capF = axle_grip(Fzf, M * st[S_AY] * HCG / 1.6 * 0.55, mu * (1 - 0.65 * aqF)),
           capR = axle_grip(Fzr, M * st[S_AY] * HCG / 1.6 * 0.45, mu * REARMU * (1 - 0.65 * aqR));
    double vxf = vx * cd + (vy + LF * r) * sd, vyf = -vx * sd + (vy + LF * r) * cd, vxr = vx, vyr = vy - LR * r;
    double af = -atan2(vyf, fmax(fabs(vxf), 0.5)), ar = -atan2(vyr, fmax(fabs(vxr), 0.5));
    double kf = clampd((st[S_WF] * RW - vxf) / fmax(fabs(vxf), 3), -1, 3), kr = clampd((st[S_WR] * RW - vxr) / fmax(fabs(vxr), 3), -1, 3);
    double Fxf, Fyf, Fxr, Fyr, satf, satr;
    combined_slip(kf, af, capF, BF, &Fxf, &Fyf, &satf); combined_slip(kr, ar, capR, BR, &Fxr, &Fyr, &satr);
    /* tyre relaxation length ~0.35 m: lateral force builds over distance rolled */
    double kr2 = fmin(1, fmax(fabs(vx), 1) * h / 0.35);
    st[S_FYFS] += (Fyf - st[S_FYFS]) * kr2; st[S_FYRS] += (Fyr - st[S_FYRS]) * kr2; Fyf = st[S_FYFS]; Fyr = st[S_FYRS];
    /* torques: engine through the gearbox on the rear, brakes on both, engine braking off throttle */
    double rpm = fmax(4200, fabs(st[S_WR]) * 60 / (2 * PI) * Gr);
    double Tdrive = st[S_CUT] > 0 ? 0 : st[S_THR] * fmin(torque_at(rpm) * Gr * 0.93, PMAX / fmax(fabs(st[S_WR]), 4));
    if (rev) {                                                        /* reverse: drive backwards, gently, up to ~30 km/h */
      Tdrive = -Tdrive * 0.35 * clampd(1 - (fabs(vx) - 6) / 3, 0, 1);
      if (aids && kr < -0.1) Tdrive *= clampd(1 - (-kr - 0.1) * 7, 0, 1);
    } else {
      if (st[S_THR] < 0.05 && st[S_WR] > 3) Tdrive -= fmin(1400 * RW, 0.11 * rpm * RW);
      if (aids && kr > 0.1) Tdrive *= clampd(1 - (kr - 0.1) * 7, 0, 1);                     /* traction control */
    }
    double Tbf = st[S_BRK] * FBRAKE * RW * BB, Tbr = st[S_BRK] * FBRAKE * RW * (1 - BB);
    if (aids && !rev) { if (kf < -0.12) Tbf *= clampd(1 + (kf + 0.12) * 8, 0, 1); if (kr < -0.12) Tbr *= clampd(1 + (kr + 0.12) * 8, 0, 1); } /* ABS */
    st[S_WF] += (-Fxf * RW) / Iwf * h; st[S_WR] += (Tdrive - Fxr * RW) / Iwr * h;
    if (rev) {                                                        /* brakes slow a wheel towards zero from either side */
      st[S_WF] = sgn(st[S_WF]) * fmax(0, fabs(st[S_WF]) - Tbf / Iwf * h);
      st[S_WR] = sgn(st[S_WR]) * fmax(0, fabs(st[S_WR]) - Tbr / Iwr * h);
    } else {                                                          /* brakes can stop a wheel but never spin it backwards */
      st[S_WF] = st[S_WF] > 0 ? fmax(0, st[S_WF] - Tbf / Iwf * h) : 0;
      st[S_WR] = st[S_WR] > 0 ? fmax(0, st[S_WR] - Tbr / Iwr * h) : fmax(0, st[S_WR]);
    }
    double FxB = Fxf * cd - Fyf * sd + Fxr, FyB = Fxf * sd + Fyf * cd + Fyr;
    double ax = (FxB - drag) / M + vy * r, ay = FyB / M - vx * r, rd = (LF * (Fxf * sd + Fyf * cd) - LR * Fyr) / IZ;
    st[S_VX] += ax * h; st[S_VY] += ay * h; st[S_R] += rd * h;
    if (!rev) {
      if (st[S_VX] < 0.4 && st[S_THR] < 0.05 && fabs(st[S_VY]) < 0.4) { st[S_VX] = fmax(0, st[S_VX]); if (st[S_VX] < 0.05) { st[S_VY] *= 0.9; st[S_R] *= 0.9; } }
      if (st[S_VX] < -1) st[S_VX] = -1;                             /* no rolling back without reverse, only a rock-back after a spin */
    } else if (st[S_THR] < 0.05 && fabs(st[S_VX]) < 0.3 && fabs(st[S_VY]) < 0.4) { st[S_VX] *= 0.9; st[S_VY] *= 0.9; st[S_R] *= 0.9; }
    st[S_AY] = lerpd(st[S_AY], ay + vx * r, 0.2); st[S_AX] = lerpd(st[S_AX], ax - vy * r, 0.15);
    st[S_KF] = kf; st[S_KR] = kr; st[S_AF] = af; st[S_AR] = ar;
    /* what the driver feels through the wheel: self-aligning torque Mz = trail · Fy. The pneumatic trail shrinks
       as the contact patch starts to slide (brush model), so Mz peaks and falls before Fy does: the steering goes
       light just before the front washes out. Normalised by trail0 · front grip. */
    double tr = 1 - fmin(1, satf / 2); st[S_MZ] = TRAIL0 * tr * tr * Fyf / (TRAIL0 * fmax(capF, 1));
    st[S_SATF] = satf; st[S_SATR] = satr;
    st[S_GRIPF] = hypot(Fxf, Fyf) / fmax(capF, 1); st[S_GRIPR] = hypot(Fxr, Fyr) / fmax(capR, 1);
    double psi = st[S_PSI], sdot = (st[S_VX] * cos(psi) - st[S_VY] * sin(psi)) / fmax(0.2, 1 - kap * st[S_LAT]);
    st[S_LATV] = st[S_VX] * sin(psi) + st[S_VY] * cos(psi);
    st[S_LAT] += st[S_LATV] * h; st[S_PSI] += (st[S_R] - kap * sdot) * h; st[S_S] = wrap_s(st[S_S] + sdot * h);
    wall_contact(wall);
  }
  st[S_PSI] = atan2(sin(st[S_PSI]), cos(st[S_PSI]));
  st[S_V] = hypot(st[S_VX], st[S_VY]);
  st[S_BETA] = atan2(st[S_VY], fmax(fabs(st[S_VX]), 3));
  st[S_SLIDING] = (fabs(st[S_AR]) > 0.12 || st[S_KR] > 0.2 || st[S_KF] < -0.3 || st[S_KR] < -0.3) ? 1 : 0;
}
