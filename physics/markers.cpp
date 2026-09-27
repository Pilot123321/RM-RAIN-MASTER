/* Screen AR: find the simulator's four calibration dots in a phone camera frame, and the homography that maps the
   game screen onto the camera image, so the phone can draw the HUD exactly over the sim picture.

   The dots are saturated discs (red, green, blue, magenta) inside a black ring, in the corners of the game view.
   Per colour class: pixels that are bright and saturated with a hue near the class hue -> 4-connected blobs -> keep
   the most disc-like blob (about square bounding box, fill ratio near pi/4, not too big) that is ringed in black.
   Kerbs, sponsor boards and TecPro blocks are stripes or filled rectangles without a dark ring and are rejected.
   Output: marker centres in frame pixels, and a bit mask of which were found. */
#include "physics.h"

namespace {
constexpr int MW = 640, MH = 480, MN = MW * MH;
uint8_t frame[MN * 4], cls[MN];
int lab[MN], que[MN];
double found[8], hom[9];
const double HUE[4] = {0, 120, 225, 300};  // red, green, blue, magenta

int classify(int i) {
  double r = frame[i * 4], g = frame[i * 4 + 1], b = frame[i * 4 + 2];
  double mx = fmax(r, fmax(g, b)), mn = fmin(r, fmin(g, b));
  if (mx < 90 || (mx - mn) < 0.42 * mx) return 0;  // too dark or too washed out (cameras desaturate a bright screen)
  double d = mx - mn, h;
  if (mx == r) h = 60 * fmod((g - b) / d, 6); else if (mx == g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  for (int k = 0; k < 4; k++) { double dh = fabs(h - HUE[k]); if (dh > 180) dh = 360 - dh; if (dh < 28) return k + 1; }
  return 0;
}
}  // namespace

extern "C" {
EXPORT(markers_frame) uint8_t *markers_frame(void) { return frame; }
EXPORT(markers_found) double *markers_found(void) { return found; }
EXPORT(markers_hom) double *markers_hom(void) { return hom; }

/* returns a bit mask of the markers found (bit k = colour class k); centres in markers_found() */
EXPORT(markers_find) int markers_find(int W, int H) {
  if (W < 8 || H < 8 || W * H > MN) return 0;
  const int n = W * H;
  for (int i = 0; i < n; i++) { cls[i] = (uint8_t)classify(i); lab[i] = -1; }
  double bestScore[4] = {0, 0, 0, 0};
  int mask = 0;
  for (int i = 0; i < n; i++) {
    if (!cls[i] || lab[i] >= 0) continue;
    int c = cls[i], h = 0, t = 0, area = 0, x0 = W, x1 = 0, y0 = H, y1 = 0; double sx = 0, sy = 0;
    que[t++] = i; lab[i] = i;
    while (h < t) {
      int j = que[h++], x = j % W, y = j / W; area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const int nb[4] = {j + 1, j - 1, j + W, j - W};
      const bool ok[4] = {x + 1 < W, x > 0, y + 1 < H, y > 0};
      for (int k = 0; k < 4; k++) if (ok[k] && cls[nb[k]] == c && lab[nb[k]] < 0) { lab[nb[k]] = i; que[t++] = nb[k]; }
    }
    int bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    double aspect = (double)bw / bh, fill = (double)area / (bw * bh);
    if (area < 4 || area > n * 0.025 || aspect < 0.55 || aspect > 1.8 || fill < 0.5 || fill > 0.96) continue;
    // the real dots sit in a black ring inside a white ring: dark just outside the blob, bright a little further
    // out. Try several radii (the rings are only a pixel or two wide when the dot is small) and keep the best;
    // scenery next to a dark area has the dark part but not the white ring.
    double cxb = sx / area, cyb = sy / area, r = sqrt(area / PI), dk = 0, br = 0;
    auto ringFrac = [&](double rad, bool wantDark) {
      int hit = 0, tot = 0;
      for (int a = 0; a < 16; a++) {
        int px = (int)lround(cxb + rad * cos(a * PI / 8)), py = (int)lround(cyb + rad * sin(a * PI / 8));
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        int q = (py * W + px) * 4; tot++;
        double mx = fmax(frame[q], fmax(frame[q + 1], frame[q + 2])), mn = fmin(frame[q], fmin(frame[q + 1], frame[q + 2]));
        if (wantDark ? mx < 70 : (mx > 110 && mx - mn < 0.35 * mx)) hit++;
      }
      return tot >= 8 ? (double)hit / tot : 0.0;
    };
    for (double f = 1.0; f <= 1.6; f += 0.1) dk = fmax(dk, ringFrac(r * f + 0.4, true));
    for (double f = 1.15; f <= 2.3; f += 0.1) br = fmax(br, ringFrac(r * f + 0.8, false));
    if (dk < 0.5 || br < 0.4) continue;
    double score = area * (1 - fabs(fill - 0.785)) * dk * br;
    if (score > bestScore[c - 1]) { bestScore[c - 1] = score; found[2 * (c - 1)] = sx / area + 0.5; found[2 * (c - 1) + 1] = sy / area + 0.5; mask |= 1 << (c - 1); }
  }
  return mask;
}

/* homography H (row-major, h33 = 1) with dst ~ H * src for 4 point pairs src[8], dst[8]; returns 1 if solvable */
EXPORT(markers_homography) int markers_homography(double sx0, double sy0, double sx1, double sy1, double sx2, double sy2, double sx3, double sy3,
                                                  double dx0, double dy0, double dx1, double dy1, double dx2, double dy2, double dx3, double dy3) {
  const double S[4][2] = {{sx0, sy0}, {sx1, sy1}, {sx2, sy2}, {sx3, sy3}}, D[4][2] = {{dx0, dy0}, {dx1, dy1}, {dx2, dy2}, {dx3, dy3}};
  double A[8][9];
  for (int k = 0; k < 4; k++) {
    double x = S[k][0], y = S[k][1], u = D[k][0], v = D[k][1];
    double r1[9] = {x, y, 1, 0, 0, 0, -u * x, -u * y, u}, r2[9] = {0, 0, 0, x, y, 1, -v * x, -v * y, v};
    for (int j = 0; j < 9; j++) { A[2 * k][j] = r1[j]; A[2 * k + 1][j] = r2[j]; }
  }
  for (int c = 0; c < 8; c++) {  // Gaussian elimination with partial pivoting
    int p = c; for (int r = c + 1; r < 8; r++) if (fabs(A[r][c]) > fabs(A[p][c])) p = r;
    if (fabs(A[p][c]) < 1e-12) return 0;
    if (p != c) for (int j = 0; j < 9; j++) { double t = A[c][j]; A[c][j] = A[p][j]; A[p][j] = t; }
    for (int r = 0; r < 8; r++) { if (r == c) continue; double f = A[r][c] / A[c][c]; for (int j = c; j < 9; j++) A[r][j] -= f * A[c][j]; }
  }
  for (int c = 0; c < 8; c++) hom[c] = A[c][8] / A[c][c];
  hom[8] = 1;
  return 1;
}
}
