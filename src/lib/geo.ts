export type LngLat = [number, number];

const R = 6371000;
const RAD = Math.PI / 180;

export function distanceM(a: LngLat, b: LngLat): number {
  const p1 = a[1] * RAD;
  const p2 = b[1] * RAD;
  const dp = p2 - p1;
  const dl = (b[0] - a[0]) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a: LngLat, b: LngLat): number {
  const p1 = a[1] * RAD;
  const p2 = b[1] * RAD;
  const dl = (b[0] - a[0]) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

/** Point at distance (m) and bearing (deg) from origin (flat-earth, fine below ~100 km). */
export function offset(p: LngLat, distM: number, bearing: number): LngLat {
  const b = bearing * RAD;
  const dy = Math.cos(b) * distM;
  const dx = Math.sin(b) * distM;
  return [p[0] + dx / (R * Math.cos(p[1] * RAD)) / RAD, p[1] + dy / R / RAD];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpLL(a: LngLat, b: LngLat, t: number): LngLat {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Deterministic pseudo-random in [0,1) from integers (for reproducible simulation). */
export function hash01(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) {
    h ^= Math.floor(x * 1000) | 0;
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function fmtLatLon(lon: number, lat: number): string {
  const dms = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const s = ((a - d) * 60 - m) * 60;
    return `${d}°${String(m).padStart(2, "0")}'${s.toFixed(1).padStart(4, "0")}"${v >= 0 ? pos : neg}`;
  };
  return `${dms(lat, "N", "S")} ${dms(lon, "E", "W")}`;
}

export function compass(deg: number | null | undefined): string {
  if (deg == null) return "—";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
