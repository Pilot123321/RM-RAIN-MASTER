/* Screen AR: find the simulator's four calibration dots in a phone camera frame, and the homography that maps the
   game screen onto the camera image, so the phone can draw the HUD exactly over the sim picture.

   The dots are saturated discs (red, green, blue, magenta) inside a black ring, in the corners of the game view.
   Per colour class: pixels that are bright and saturated with a hue near the class hue -> 4-connected blobs -> keep
   the most disc-like blob (an ellipse under perspective, not too big) that is ringed in black and white.
   Kerbs, sponsor boards and TecPro blocks are stripes or filled rectangles without a dark ring and are rejected.
   Output: marker centres in frame pixels, and a bit mask of which were found. Six more dots along the edges are
   then found near where the corners predict them, and all of them together fit the mapping and the lens bend. */
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
/* score of one colour blob as a calibration dot (0 = not a dot): disc-like (an ellipse under perspective) and ringed
   in black, then white. Kerbs, sponsor boards and TecPro blocks are stripes or filled rectangles without the rings. */
double blobScore(int W, int H, int area, double sx, double sy, double sxx, double sxy, double syy, int x0, int x1, int y0, int y1, double maxArea) {
  int bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  double aspect = (double)bw / bh, fill = (double)area / (bw * bh);
  if (area < 4 || area > maxArea || aspect < 0.3 || aspect > 3.4 || fill < 0.4 || fill > 0.96) return 0;
  // The real dots sit in a black ring inside a white ring. Require that order along rays out of the blob;
  // scenery next to a dark area has the dark part but not the surrounding white ring.
  // The camera sees ellipses when the screen is tilted. Estimate their axes from the blob's covariance;
  // sampling circular rings rejects valid oblique views and makes detection depend on phone roll.
  double cxb = sx / area, cyb = sy / area;
  double vx = sxx / area - cxb * cxb + 1.0 / 12, vy = syy / area - cyb * cyb + 1.0 / 12, xy = sxy / area - cxb * cyb;
  double spread = hypot(vx - vy, 2 * xy), major = 2 * sqrt((vx + vy + spread) / 2), minor = 2 * sqrt(fmax(0, (vx + vy - spread) / 2));
  if (minor < 0.32 * major) return 0;
  double angle = atan2(2 * xy, vx - vy) / 2, ca = cos(angle), sa = sin(angle);
  int ringHits = 0;
  for (int a = 0; a < 16; a++) {
    double ex = major * cos(a * PI / 8), ey = minor * sin(a * PI / 8);
    bool dark = false;
    // The narrow outer ring can occupy a single pixel in a downsampled phone frame. A radial band also
    // tolerates small errors in the ellipse estimate without assuming the marker is front-on.
    for (int step = 0; step <= 28; step++) {
      double f = 0.95 + step * 0.05;
      int px = (int)lround(cxb + f * (ca * ex - sa * ey)), py = (int)lround(cyb + f * (sa * ex + ca * ey));
      if (px < 0 || py < 0 || px >= W || py >= H) break;
      int q = (py * W + px) * 4;
      double mx = fmax(frame[q], fmax(frame[q + 1], frame[q + 2])), mn = fmin(frame[q], fmin(frame[q + 1], frame[q + 2]));
      if (mx < 70) dark = true;
      else if (dark && mx > 110 && mx - mn < 0.35 * mx) { ringHits++; break; }
    }
  }
  if (ringHits < 9) return 0;
  return area * (1 - fabs(fill - 0.785)) * ringHits / 16;
}

double nearPt[2], fitIn[64 * 4], fitOut[4];
/* least-squares homography (h33 = 1) from n >= 4 pairs src -> dst, dst first undistorted with radial coefficient k1
   around (cx, cy): u = c + (d - c)(1 + k1 |d - c|^2 / rn^2). Coordinates are normalised for conditioning.
   Writes H into h and returns the RMS reprojection error in dst units, or -1. */
double fitHom(int n, double cx, double cy, double rn, double k1, double *h) {
  static double S[64][2], D[64][2];
  double sc[2] = {}, dc[2] = {}, ss = 0, ds = 0;
  for (int i = 0; i < n; i++) {
    const double *q = fitIn + 4 * i; double dx = q[2] - cx, dy = q[3] - cy, f = 1 + k1 * (dx * dx + dy * dy) / (rn * rn);
    S[i][0] = q[0]; S[i][1] = q[1]; D[i][0] = cx + dx * f; D[i][1] = cy + dy * f;
    for (int j = 0; j < 2; j++) { sc[j] += S[i][j] / n; dc[j] += D[i][j] / n; }
  }
  for (int i = 0; i < n; i++) for (int j = 0; j < 2; j++) { ss = fmax(ss, fabs(S[i][j] - sc[j])); ds = fmax(ds, fabs(D[i][j] - dc[j])); }
  if (ss < 1e-9 || ds < 1e-9) return -1;
  double M[8][9] = {};
  for (int i = 0; i < n; i++) {
    double x = (S[i][0] - sc[0]) / ss, y = (S[i][1] - sc[1]) / ss, u = (D[i][0] - dc[0]) / ds, v = (D[i][1] - dc[1]) / ds;
    double r1[9] = {x, y, 1, 0, 0, 0, -u * x, -u * y, u}, r2[9] = {0, 0, 0, x, y, 1, -v * x, -v * y, v};
    for (int a = 0; a < 8; a++) for (int b = 0; b < 9; b++) M[a][b] += r1[a] * r1[b] + r2[a] * r2[b];  // normal equations
  }
  for (int c = 0; c < 8; c++) {
    int p = c; for (int r = c + 1; r < 8; r++) if (fabs(M[r][c]) > fabs(M[p][c])) p = r;
    if (fabs(M[p][c]) < 1e-12) return -1;
    if (p != c) for (int j = 0; j < 9; j++) { double t = M[c][j]; M[c][j] = M[p][j]; M[p][j] = t; }
    for (int r = 0; r < 8; r++) { if (r == c) continue; double f = M[r][c] / M[c][c]; for (int j = c; j < 9; j++) M[r][j] -= f * M[c][j]; }
  }
  double nh[9], out[9];
  for (int c = 0; c < 8; c++) nh[c] = M[c][8] / M[c][c];
  nh[8] = 1;
  for (int r = 0; r < 3; r++) { out[3 * r] = nh[3 * r] / ss; out[3 * r + 1] = nh[3 * r + 1] / ss; out[3 * r + 2] = nh[3 * r + 2] - (nh[3 * r] * sc[0] + nh[3 * r + 1] * sc[1]) / ss; }
  for (int j = 0; j < 3; j++) { out[j] = ds * out[j] + dc[0] * out[6 + j]; out[3 + j] = ds * out[3 + j] + dc[1] * out[6 + j]; }
  if (!isfinite(out[8]) || fabs(out[8]) < 1e-12) return -1;
  for (int j = 0; j < 9; j++) { h[j] = out[j] / out[8]; if (!isfinite(h[j])) return -1; }
  double e = 0;
  for (int i = 0; i < n; i++) {
    double w = h[6] * S[i][0] + h[7] * S[i][1] + h[8]; if (fabs(w) < 1e-12) return -1;
    double px = (h[0] * S[i][0] + h[1] * S[i][1] + h[2]) / w - D[i][0], py = (h[3] * S[i][0] + h[4] * S[i][1] + h[5]) / w - D[i][1];
    e += px * px + py * py;
  }
  return sqrt(e / n);
}
}  // namespace

extern "C" {
EXPORT(markers_frame) uint8_t *markers_frame(void) { return frame; }
EXPORT(markers_found) double *markers_found(void) { return found; }
EXPORT(markers_hom) double *markers_hom(void) { return hom; }
EXPORT(markers_near) double *markers_near(void) { return nearPt; }
EXPORT(markers_fit_in) double *markers_fit_in(void) { return fitIn; }
EXPORT(markers_fit_out) double *markers_fit_out(void) { return fitOut; }

/* one dot of colour class c (0..3) within rad pixels of (x, y), where the other dots predict it; the closest good
   candidate wins. Used for the extra dots along the screen edges. Returns 1 if found (centre in markers_near()). */
EXPORT(markers_find_near) int markers_find_near(int W, int H, int c, double x, double y, double rad) {
  if (W < 8 || H < 8 || W > MN / H || c < 0 || c > 3 || !(rad > 1)) return 0;
  const int X0 = (int)fmax(0, floor(x - rad)), X1 = (int)fmin(W - 1, ceil(x + rad)), Y0 = (int)fmax(0, floor(y - rad)), Y1 = (int)fmin(H - 1, ceil(y + rad));
  if (X0 > X1 || Y0 > Y1) return 0;
  for (int yy = Y0; yy <= Y1; yy++) for (int xx = X0; xx <= X1; xx++) { int i = yy * W + xx; cls[i] = classify(i) == c + 1; lab[i] = -1; }
  double best = 0;
  for (int yy = Y0; yy <= Y1; yy++) for (int xx = X0; xx <= X1; xx++) {
    int i = yy * W + xx;
    if (!cls[i] || lab[i] >= 0) continue;
    int h = 0, t = 0, area = 0, x0 = W, x1 = 0, y0 = H, y1 = 0; double sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    que[t++] = i; lab[i] = i;
    while (h < t) {
      int j = que[h++], px = j % W, py = j / W; area++; sx += px; sy += py;
      sxx += (double)px * px; sxy += (double)px * py; syy += (double)py * py;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      const int nb[4] = {j + 1, j - 1, j + W, j - W};
      const bool ok[4] = {px + 1 <= X1, px > X0, py + 1 <= Y1, py > Y0};
      for (int k = 0; k < 4; k++) if (ok[k] && cls[nb[k]] && lab[nb[k]] < 0) { lab[nb[k]] = i; que[t++] = nb[k]; }
    }
    double sc = blobScore(W, H, area, sx, sy, sxx, sxy, syy, x0, x1, y0, y1, (double)W * H * 0.025);
    if (sc <= 0) continue;
    double cxb = sx / area + 0.5, cyb = sy / area + 0.5, d = hypot(cxb - x, cyb - y) / rad;
    sc *= exp(-2 * d * d);
    if (sc > best) { best = sc; nearPt[0] = cxb; nearPt[1] = cyb; }
  }
  return best > 0;
}

/* Fit the screen -> camera mapping to n point pairs in markers_fit_in() (sx, sy, dx, dy each): a homography plus
   one radial lens coefficient k1 about (cx, cy), normalised by rn. Four points only fix a homography, which draws
   straight lines straight; a phone lens bends them (barrel distortion), so the HUD's curves drifted off the sim's.
   The extra dots along the edges measure that bend. estimate = 1 searches k1 in [-0.35, 0.35] (golden section on
   the RMS error), otherwise k1 is used as given. Output: H in markers_hom(), [k1, rms] in markers_fit_out(). */
EXPORT(markers_fit) int markers_fit(int n, double cx, double cy, double rn, double k1, int estimate) {
  if (n < 4 || n > 64 || !(rn > 0)) return 0;
  double h[9];
  if (estimate && n >= 6) {
    double a = -0.35, b = 0.35; const double g = 0.6180339887;
    double c1 = b - g * (b - a), c2 = a + g * (b - a), f1 = fitHom(n, cx, cy, rn, c1, h), f2 = fitHom(n, cx, cy, rn, c2, h);
    for (int it = 0; it < 40; it++) {
      if (f1 < 0 || f2 < 0) break;
      if (f1 < f2) { b = c2; c2 = c1; f2 = f1; c1 = b - g * (b - a); f1 = fitHom(n, cx, cy, rn, c1, h); }
      else { a = c1; c1 = c2; f1 = f2; c2 = a + g * (b - a); f2 = fitHom(n, cx, cy, rn, c2, h); }
    }
    k1 = (a + b) / 2;
  }
  double rms = fitHom(n, cx, cy, rn, k1, h);
  if (rms < 0) return 0;
  for (int j = 0; j < 9; j++) hom[j] = h[j];
  fitOut[0] = k1; fitOut[1] = rms;
  return 1;
}

/* returns a bit mask of the markers found (bit k = colour class k); centres in markers_found() */
EXPORT(markers_find) int markers_find(int W, int H) {
  for (double &v : found) v = 0;
  if (W < 8 || H < 8 || W > MN / H) return 0;
  const int n = W * H;
  for (int i = 0; i < n; i++) { cls[i] = (uint8_t)classify(i); lab[i] = -1; }
  double bestScore[4] = {0, 0, 0, 0};
  int mask = 0;
  for (int i = 0; i < n; i++) {
    if (!cls[i] || lab[i] >= 0) continue;
    int c = cls[i], h = 0, t = 0, area = 0, x0 = W, x1 = 0, y0 = H, y1 = 0; double sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    que[t++] = i; lab[i] = i;
    while (h < t) {
      int j = que[h++], x = j % W, y = j / W; area++; sx += x; sy += y;
      sxx += (double)x * x; sxy += (double)x * y; syy += (double)y * y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const int nb[4] = {j + 1, j - 1, j + W, j - W};
      const bool ok[4] = {x + 1 < W, x > 0, y + 1 < H, y > 0};
      for (int k = 0; k < 4; k++) if (ok[k] && cls[nb[k]] == c && lab[nb[k]] < 0) { lab[nb[k]] = i; que[t++] = nb[k]; }
    }
    double score = blobScore(W, H, area, sx, sy, sxx, sxy, syy, x0, x1, y0, y1, n * 0.025);
    if (score <= 0) continue;
    if (score > bestScore[c - 1]) { bestScore[c - 1] = score; found[2 * (c - 1)] = sx / area + 0.5; found[2 * (c - 1) + 1] = sy / area + 0.5; mask |= 1 << (c - 1); }
  }
  return mask;
}

/* Homography H (row-major, h33 = 1) with dst ~ H * src for four ordered screen corners.
   Both quads must be finite, convex and nondegenerate. Returns 1 only for a usable screen mapping. */
EXPORT(markers_homography) int markers_homography(double sx0, double sy0, double sx1, double sy1, double sx2, double sy2, double sx3, double sy3,
                                                  double dx0, double dy0, double dx1, double dy1, double dx2, double dy2, double dx3, double dy3) {
  double S[4][2] = {{sx0, sy0}, {sx1, sy1}, {sx2, sy2}, {sx3, sy3}}, D[4][2] = {{dx0, dy0}, {dx1, dy1}, {dx2, dy2}, {dx3, dy3}};
  double sc[2] = {}, dc[2] = {}, ss = 0, ds = 0;
  auto normalize = [](double p[4][2], double centre[2], double &scale) {
    for (int i = 0; i < 4; i++) for (int j = 0; j < 2; j++) {
      if (!isfinite(p[i][j])) return false;
      centre[j] += p[i][j] / 4;
    }
    for (int i = 0; i < 4; i++) for (int j = 0; j < 2; j++) scale = fmax(scale, fabs(p[i][j] - centre[j]));
    if (!isfinite(scale) || scale < 1e-9) return false;
    for (int i = 0; i < 4; i++) for (int j = 0; j < 2; j++) p[i][j] = (p[i][j] - centre[j]) / scale;
    double sign = 0;
    for (int i = 0; i < 4; i++) {
      const double *a = p[i], *b = p[(i + 1) % 4], *c = p[(i + 2) % 4];
      double cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (fabs(cross) < 1e-4 || (i && cross * sign <= 0)) return false;
      sign = cross;
    }
    return true;
  };
  if (!normalize(S, sc, ss) || !normalize(D, dc, ds)) return 0;
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
  double nh[9], out[9];
  for (int c = 0; c < 8; c++) nh[c] = A[c][8] / A[c][c];
  nh[8] = 1;
  // Undo the coordinate normalization: H = inverse(Tdst) * Hnormalized * Tsrc.
  for (int r = 0; r < 3; r++) {
    out[3 * r] = nh[3 * r] / ss;
    out[3 * r + 1] = nh[3 * r + 1] / ss;
    out[3 * r + 2] = nh[3 * r + 2] - (nh[3 * r] * sc[0] + nh[3 * r + 1] * sc[1]) / ss;
  }
  for (int j = 0; j < 3; j++) {
    out[j] = ds * out[j] + dc[0] * out[6 + j];
    out[3 + j] = ds * out[3 + j] + dc[1] * out[6 + j];
  }
  if (!isfinite(out[8]) || fabs(out[8]) < 1e-12) return 0;
  double divisor = out[8];
  for (double &v : out) { v /= divisor; if (!isfinite(v)) return 0; }
  for (int j = 0; j < 9; j++) hom[j] = out[j];
  return 1;
}
}
