/* Tyre spray behind a car on a wet track.
   Water leaves the rear of each tyre and the diffuser as droplets of mixed size: a fine mist (40-80 µm) and a
   log-normal body of larger drops (median ~0.25 mm). Each droplet follows the air with a response time
   τ = v_t/g (terminal velocity v_t: Stokes law for small drops, Atlas et al. 1973 fit for larger ones):
       dv/dt = (u_air - v)/τ + g
   The air is the car's wake: dragged along behind the car and lifted by the diffuser/rear-wing upwash, which
   decays over ~1.4 s. Upwash strength scales with speed, so the mist column climbs with speed: roughly 3 m at
   100 km/h and 8-10 m at 250-300 km/h, as seen behind F1 cars in heavy rain. Turbulence is a random walk on
   the droplet velocity. The render arrays (position, sprite size, opacity) live here and three.js draws them
   straight from WebAssembly memory. */
#include "physics.h"

#define NP 7000
#define K_UP 0.09        /* wake upwash per unit car speed */
#define T_UP 1.4         /* upwash decay time, s */
#define T_DRAG 0.8       /* wake along-track air speed decay, s */

static float pos[NP * 3], size_[NP], alpha_[NP];
static float vel[NP * 3], age[NP], life[NP], tau[NP], w0[NP], cvx[NP], cvz[NP], gy[NP], mist[NP];
static int head;
static rng_t RNG = {0xD1B54A32D192ED03ULL};

EXPORT(spray_count) int spray_count(void) { return NP; }
EXPORT(spray_pos) float *spray_pos(void) { return pos; }
EXPORT(spray_size) float *spray_size(void) { return size_; }
EXPORT(spray_alpha) float *spray_alpha(void) { return alpha_; }
EXPORT(spray_clear) void spray_clear(void) { for (int i = 0; i < NP; i++) { age[i] = 99; life[i] = 1; alpha_[i] = 0; } head = 0; }

/* terminal fall speed of a water drop of diameter d (m) in air */
EXPORT(spray_vt) double spray_vt(double d) {
  double stokes = 1000.0 * G0 * d * d / (18 * 1.8e-5), atlas = 9.65 - 10.3 * exp(-600 * d);
  double v = (atlas > 0 && atlas < stokes) ? atlas : stokes;
  return v > 0.005 ? v : 0.005;
}

/* n droplets from a point (x, y, z) behind a car moving at (vx, vz), ground height g */
EXPORT(spray_emit) void spray_emit(int n, double x, double y, double z, double vx, double vz, double g) {
  double sp = hypot(vx, vz);
  for (int k = 0; k < n; k++) {
    int i = head; head = (head + 1) % NP;
    int m = rng_u(&RNG) < 0.35;
    double d = m ? 40e-6 + rng_u(&RNG) * 40e-6 : fmin(1.5e-3, 2.5e-4 * exp(0.6 * rng_n(&RNG)));
    double vt = spray_vt(d), keep = 0.2 + 0.4 * rng_u(&RNG);
    pos[i * 3] = x + (rng_u(&RNG) - 0.5) * 0.4; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z + (rng_u(&RNG) - 0.5) * 0.4;
    vel[i * 3] = vx * keep + rng_n(&RNG) * 0.05 * sp; vel[i * 3 + 2] = vz * keep + rng_n(&RNG) * 0.05 * sp;
    vel[i * 3 + 1] = sp * (0.02 + 0.1 * rng_u(&RNG));                  /* thrown up off the tread */
    tau[i] = vt / G0; w0[i] = K_UP * sp * (0.7 + 0.6 * rng_u(&RNG)); cvx[i] = vx; cvz[i] = vz; gy[i] = g; mist[i] = m;
    age[i] = 0; life[i] = m ? 2.2 + 1.2 * rng_u(&RNG) : 0.9 + 1.0 * rng_u(&RNG);
  }
}

EXPORT(spray_update) void spray_update(double dt, double rain) {
  double sq = sqrt(dt);
  for (int i = 0; i < NP; i++) {
    if (age[i] > life[i]) { alpha_[i] = 0; continue; }
    age[i] += dt;
    double a = age[i], ux = cvx[i] * 0.3 * exp(-a / T_DRAG), uz = cvz[i] * 0.3 * exp(-a / T_DRAG), uy = w0[i] * exp(-a / T_UP);
    double tt = tau[i], turb = 2.2 * sq;
    float *v = &vel[i * 3], *p = &pos[i * 3];
    /* implicit step of dv/dt = (u - v)/τ + g, stable for the tiny τ of mist */
    v[0] = (float)((v[0] + dt * ux / tt) / (1 + dt / tt) + rng_n(&RNG) * turb);
    v[1] = (float)((v[1] + dt * (uy / tt - G0)) / (1 + dt / tt) + rng_n(&RNG) * turb * 0.5);
    v[2] = (float)((v[2] + dt * uz / tt) / (1 + dt / tt) + rng_n(&RNG) * turb);
    p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
    if (p[1] < gy[i]) { p[1] = gy[i]; if (!mist[i]) { age[i] = life[i] + 1; alpha_[i] = 0; continue; } v[1] = 0; }
    double f = a / life[i]; if (f > 1) f = 1;
    size_[i] = (float)(mist[i] ? 1.2 + 8.5 * f : 0.5 + 2.8 * f);
    alpha_[i] = (float)((0.05 + 0.09 * rain) * (mist[i] ? 1.0 : 0.55) * pow(1 - f, 1.3) * fmin(1, a * 8));
  }
}

/* q-quantile of the height above the road of live spray (for the Python checks) */
EXPORT(spray_height_q) double spray_height_q(double q) {
  static int hist[400]; int n = 0;
  for (int b = 0; b < 400; b++) hist[b] = 0;
  for (int i = 0; i < NP; i++) { if (age[i] > life[i] || !mist[i]) continue; int b = (int)((pos[i * 3 + 1] - gy[i]) * 10); if (b < 0) b = 0; if (b > 399) b = 399; hist[b]++; n++; }
  if (!n) return 0;
  int want = (int)(q * n), c = 0;
  for (int b = 0; b < 400; b++) { c += hist[b]; if (c > want) return b / 10.0; }
  return 40;
}
