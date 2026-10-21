// Solar position (NOAA / Meeus approximation, ±0.5°) — enough for day/night shading,
// terrain light direction and deciding when aircraft can fly.

const RAD = Math.PI / 180;

export interface SunPos {
  altitude: number; // degrees above horizon
  azimuth: number; // degrees clockwise from north
}

export function sunPosition(epochSec: number, lon: number, lat: number): SunPos {
  const jd = epochSec / 86400 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lon) * RAD;
  const ha = lst - ra;
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { altitude: alt / RAD, azimuth: ((az / RAD) + 360) % 360 };
}

/** 0 at night, 1 in daylight, smooth through civil twilight. */
export function daylight(epochSec: number, lon: number, lat: number): number {
  const a = sunPosition(epochSec, lon, lat).altitude;
  return Math.min(1, Math.max(0, (a + 6) / 12));
}

/** Night intervals [start, end) between t0 and t1, sampled every 10 min. */
export function nightIntervals(t0: number, t1: number, lon: number, lat: number): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  for (let t = t0; t <= t1; t += 600) {
    const night = sunPosition(t, lon, lat).altitude < -0.833;
    if (night && start === null) start = t;
    if (!night && start !== null) {
      out.push([start, t]);
      start = null;
    }
  }
  if (start !== null) out.push([start, t1]);
  return out;
}
