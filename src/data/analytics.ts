// Time-indexed queries over an incident bundle. Everything is a pure function of time so the
// timeline can be scrubbed freely in both directions.

import type { HotspotTrack, IncidentBundle, Pass, WeatherHour } from "./types";
import type { LngLat } from "../lib/geo";
import { lerp, lerpLL } from "../lib/geo";

export const FRONT_WINDOW_S = 12 * 3600;

function upperBound(a: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function areaAt(b: IncidentBundle, t: number): number {
  return upperBound(b.arrival.sorted, t) * b.arrival.cellHa;
}

export function frontAreaAt(b: IncidentBundle, t: number, window = FRONT_WINDOW_S): number {
  return areaAt(b, t) - areaAt(b, t - window);
}

/** Index range [i0, i1) of detections observed in (t - window, t]. Detections are time-sorted. */
export function detectionRange(b: IncidentBundle, t: number, window = FRONT_WINDOW_S): [number, number] {
  const t0 = b.meta.t0_epoch;
  const m = b.detections.t;
  const hi = upperBound(m, (t - t0) / 60);
  const lo = upperBound(m, (t - window - t0) / 60);
  return [lo, hi];
}

export function lastPass(b: IncidentBundle, t: number, withFire = true): Pass | null {
  let best: Pass | null = null;
  for (const p of b.meta.passes) {
    if (p.t > t) break;
    if (!withFire || p.n > 0) best = p;
  }
  return best;
}

export function passesWithFire(b: IncidentBundle): Pass[] {
  return b.meta.passes.filter((p) => p.n > 0);
}

export function weatherAt(b: IncidentBundle, t: number): WeatherHour | null {
  const w = b.weather;
  if (!w || !w.hourly.length) return null;
  const h = w.hourly;
  const i = Math.round((t - h[0].t) / 3600);
  if (i < 0 || i >= h.length) return null;
  // nearest hour with data within ±2 h
  for (const d of [0, -1, 1, -2, 2]) {
    const x = h[i + d];
    if (x && x.wspd != null) return x;
  }
  return h[i];
}

/** Wind direction the smoke travels toward (deg), defaulting to the day's spread bearing. */
export function windToward(b: IncidentBundle, t: number): { toward: number; kmh: number } {
  const w = weatherAt(b, t);
  if (w && w.wdir != null && w.wspd != null) return { toward: (w.wdir + 180) % 360, kmh: w.wspd };
  const d = b.meta.days.find((x) => x.t_end >= t);
  return { toward: d?.bearing ?? 45, kmh: w?.wspd ?? 10 };
}

export type HotspotStatus = "new" | "intensifying" | "steady" | "cooling" | "out";

export interface HotspotState {
  id: string;
  pos: LngLat;
  frp: number; // MW, interpolated between overpasses
  frpMax: number;
  bt4: number;
  pixels: number;
  status: HotspotStatus;
  lastSeen: number;
  firstSeen: number;
  track: HotspotTrack;
}

const ACTIVE_AFTER_S = 14 * 3600;
const COOLING_AFTER_S = 30 * 3600;

export function hotspotAt(tr: HotspotTrack, t: number): HotspotState | null {
  const o = tr.obs;
  if (t < o[0].t - 1800) return null;
  const last = o[o.length - 1];
  if (t > last.t + COOLING_AFTER_S) return null;
  let i = 0;
  while (i < o.length - 1 && o[i + 1].t <= t) i++;
  const a = o[i];
  const nb = o[i + 1];
  let pos: LngLat = [a.lon, a.lat];
  let frp = a.frp;
  if (nb && t > a.t) {
    const k = (t - a.t) / (nb.t - a.t);
    pos = lerpLL([a.lon, a.lat], [nb.lon, nb.lat], k);
    frp = lerp(a.frp, nb.frp, k);
  }
  const since = t - a.t;
  let status: HotspotStatus;
  if (t < o[0].t) status = "new";
  else if (t - o[0].t < 6 * 3600 && i === 0) status = "new";
  else if (t > last.t + ACTIVE_AFTER_S) status = "cooling";
  else if (i > 0 && a.frp > o[i - 1].frp * 1.25 && since < 12 * 3600) status = "intensifying";
  else if (i > 0 && a.frp < o[i - 1].frp * 0.6) status = "cooling";
  else status = "steady";
  if (t > last.t) {
    // decay after the last sighting
    frp = last.frp * Math.max(0, 1 - (t - last.t) / COOLING_AFTER_S);
  }
  return {
    id: tr.id,
    pos,
    frp,
    frpMax: a.frp_max,
    bt4: a.bt4_max,
    pixels: a.n,
    status,
    lastSeen: Math.min(t, a.t),
    firstSeen: o[0].t,
    track: tr,
  };
}

export function activeHotspots(b: IncidentBundle, t: number): HotspotState[] {
  const out: HotspotState[] = [];
  for (const tr of b.tracks) {
    if (tr.t_first - 1800 > t) continue;
    const s = hotspotAt(tr, t);
    if (s && s.status !== "out") out.push(s);
  }
  out.sort((a, b2) => b2.frp - a.frp);
  return out;
}

/** Arrival time & severity at a lon/lat (grid lookup). */
export function cellAt(b: IncidentBundle, lon: number, lat: number): { arrival: number | null; severity: number | null } | null {
  const c = b.meta.grid.corners; // tl, tr, br, bl in lon/lat (mercator-aligned)
  const mx = (x: number) => x;
  const my = (y: number) => Math.log(Math.tan(Math.PI / 4 + (y * Math.PI) / 360));
  const fx = (mx(lon) - mx(c[0][0])) / (mx(c[1][0]) - mx(c[0][0]));
  const fy = (my(c[0][1]) - my(lat)) / (my(c[0][1]) - my(c[3][1]));
  if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return null;
  const { width, height, t, severity } = b.arrival;
  const i = Math.floor(fy * height) * width + Math.floor(fx * width);
  const a = t[i];
  const s = severity[i];
  return { arrival: Number.isFinite(a) ? a : null, severity: Number.isFinite(s) ? s : null };
}

export interface SeriesPoint {
  t: number;
  v: number;
}

export function areaSeries(b: IncidentBundle): SeriesPoint[] {
  return b.meta.hourly.t.map((t, i) => ({ t, v: b.meta.hourly.area_ha[i] }));
}

/** Expansion rate (ha/h) smoothed over 6 h. */
export function rateSeries(b: IncidentBundle): SeriesPoint[] {
  const a = b.meta.hourly.area_ha;
  const ts = b.meta.hourly.t;
  return ts.map((t, i) => {
    const j = Math.max(0, i - 6);
    return { t, v: i === j ? 0 : (a[i] - a[j]) / (i - j) };
  });
}

export function frpSeries(b: IncidentBundle): SeriesPoint[] {
  return b.meta.passes.map((p) => ({ t: p.t, v: p.frp }));
}

export function severityClass(b: IncidentBundle, dnbr: number | null): string | null {
  if (dnbr == null) return null;
  const cls = b.meta.imagery?.severity_classes ?? [];
  let label: string | null = dnbr < 0.1 ? "Unburned / regrowth" : null;
  for (const c of cls) if (dnbr >= c.min_dnbr) label = c.label;
  return label;
}

/** Spread bearing in degrees for the day containing t (from the pipeline's daily stats). */
export function spreadBearing(b: IncidentBundle, t: number): number | null {
  const d = b.meta.days.find((x) => x.t_end >= t);
  return d?.bearing ?? null;
}

type FrontGeom = { head: LngLat | null; centroid: LngLat | null; frontCells: number };
const fgCache = new WeakMap<IncidentBundle, Map<number, FrontGeom>>();

/** Centroid of the last 6 h of growth (the head of the fire) and of the whole burned area, cached per 10 min. */
export function frontGeometry(b: IncidentBundle, t: number): FrontGeom {
  const q = Math.floor(t / 600) * 600;
  let m = fgCache.get(b);
  if (!m) fgCache.set(b, (m = new Map()));
  let v = m.get(q);
  if (!v) {
    v = computeFrontGeometry(b, q);
    if (m.size > 400) m.clear();
    m.set(q, v);
  }
  return v;
}

function computeFrontGeometry(b: IncidentBundle, t: number): FrontGeom {
  const { width, height, t: arr } = b.arrival;
  let sx = 0, sy = 0, n = 0, fx = 0, fy = 0, fn = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 60000)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const a = arr[y * width + x];
      if (a <= t) {
        sx += x; sy += y; n++;
        if (a > t - 6 * 3600) {
          fx += x; fy += y; fn++;
        }
      }
    }
  }
  const toLL = (px: number, py: number) => gridToLngLat(b, px, py);
  return {
    centroid: n ? toLL(sx / n, sy / n) : null,
    head: fn ? toLL(fx / fn, fy / fn) : null,
    frontCells: fn * step * step,
  };
}

export function gridToLngLat(b: IncidentBundle, px: number, py: number): LngLat {
  const c = b.meta.grid.corners;
  const { width, height } = b.arrival;
  const u = px / width;
  const v = py / height;
  const lon = c[0][0] + (c[1][0] - c[0][0]) * u;
  const my0 = Math.log(Math.tan(Math.PI / 4 + (c[0][1] * Math.PI) / 360));
  const my1 = Math.log(Math.tan(Math.PI / 4 + (c[3][1] * Math.PI) / 360));
  const my = my0 + (my1 - my0) * v;
  return [lon, ((Math.atan(Math.exp(my)) - Math.PI / 4) * 360) / Math.PI];
}

export function lngLatToGrid(b: IncidentBundle, lon: number, lat: number): [number, number] {
  const c = b.meta.grid.corners;
  const { width, height } = b.arrival;
  const my = (y: number) => Math.log(Math.tan(Math.PI / 4 + (y * Math.PI) / 360));
  const u = (lon - c[0][0]) / (c[1][0] - c[0][0]);
  const v = (my(c[0][1]) - my(lat)) / (my(c[0][1]) - my(c[3][1]));
  return [u * width, v * height];
}

const freshCache = new WeakMap<IncidentBundle, Map<string, LngLat | null>>();

/** Freshest burning cell (ignited in the last 12 h) within `radiusM` of p, favouring nearby cells. Cached per 10 min. */
export function freshestNear(b: IncidentBundle, p: LngLat, T: number, radiusM: number): LngLat | null {
  const key = `${p[0].toFixed(3)},${p[1].toFixed(3)},${Math.floor(T / 600)},${radiusM}`;
  let m = freshCache.get(b);
  if (!m) freshCache.set(b, (m = new Map()));
  if (m.has(key)) return m.get(key)!;
  const [gx, gy] = lngLatToGrid(b, p[0], p[1]);
  const r = Math.ceil(radiusM / b.meta.grid.res_m);
  const { width, height, t } = b.arrival;
  const tq = Math.floor(T / 600) * 600;
  let best = Infinity;
  let bx = -1;
  let by = -1;
  const step = r > 60 ? 2 : 1;
  for (let y = Math.max(0, (gy | 0) - r); y < Math.min(height, (gy | 0) + r); y += step) {
    for (let x = Math.max(0, (gx | 0) - r); x < Math.min(width, (gx | 0) + r); x += step) {
      const age = tq - t[y * width + x];
      if (age < 0 || age > 12 * 3600) continue;
      const score = age + Math.hypot(x - gx, y - gy) * b.meta.grid.res_m * 2; // 1 km ~ 2000 s
      if (score < best) {
        best = score;
        bx = x;
        by = y;
      }
    }
  }
  const out = bx < 0 ? null : gridToLngLat(b, bx + 0.5, by + 0.5);
  if (m.size > 2000) m.clear();
  m.set(key, out);
  return out;
}
