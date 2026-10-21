// Simulated firefighting response on the real fire: aircraft drop cycles, ground units on the
// perimeter, containment line, personnel. The schedule is computed once per incident by an
// event-driven simulation, then every query is a pure function of time.

import type { IncidentBundle, Perimeters } from "../data/types";
import { activeHotspots, areaAt, freshestNear, frontGeometry, passesWithFire } from "../data/analytics";
import { bearingDeg, distanceM, hash01, lerpLL, offset, type LngLat } from "../lib/geo";
import { sunPosition } from "../lib/sun";

export type UnitGroup = "air" | "engines" | "crews";

export interface UnitSpec {
  id: string;
  name: string;
  group: UnitGroup;
  kind: "vlat" | "lat" | "seat" | "heli" | "airattack" | "engine" | "tender" | "crew" | "dozer";
  capacityGal: number; // per load (aircraft) or tank (engines)
  speedKmh: number;
  reloadMin: number;
  dropLenM: number;
  agent: "retardant" | "water" | null;
  crew: number;
  responseH: number; // hours after first detection until the unit is on scene
}

const US_UNITS: UnitSpec[] = [
  { id: "T-910", name: "DC-10 VLAT", group: "air", kind: "vlat", capacityGal: 9400, speedKmh: 560, reloadMin: 30, dropLenM: 1600, agent: "retardant", crew: 3, responseH: 5 },
  { id: "T-131", name: "C-130Q LAT", group: "air", kind: "lat", capacityGal: 4000, speedKmh: 500, reloadMin: 22, dropLenM: 900, agent: "retardant", crew: 3, responseH: 3 },
  { id: "T-162", name: "RJ85 LAT", group: "air", kind: "lat", capacityGal: 3000, speedKmh: 520, reloadMin: 20, dropLenM: 800, agent: "retardant", crew: 2, responseH: 2.5 },
  { id: "T-88", name: "S-2T Tracker", group: "air", kind: "seat", capacityGal: 1200, speedKmh: 420, reloadMin: 12, dropLenM: 450, agent: "retardant", crew: 1, responseH: 0.5 },
  { id: "H-743", name: "S-64 Air-Crane", group: "air", kind: "heli", capacityGal: 2650, speedKmh: 170, reloadMin: 4, dropLenM: 260, agent: "water", crew: 3, responseH: 2 },
  { id: "H-531", name: "S-70i Firehawk", group: "air", kind: "heli", capacityGal: 1000, speedKmh: 250, reloadMin: 3, dropLenM: 180, agent: "water", crew: 3, responseH: 1 },
  { id: "AA-52", name: "OV-10A Air Attack", group: "air", kind: "airattack", capacityGal: 0, speedKmh: 360, reloadMin: 0, dropLenM: 0, agent: null, crew: 2, responseH: 0.7 },
  { id: "E-31", name: "Type 3 Engine", group: "engines", kind: "engine", capacityGal: 500, speedKmh: 25, reloadMin: 0, dropLenM: 0, agent: null, crew: 4, responseH: 0.4 },
  { id: "E-32", name: "Type 3 Engine", group: "engines", kind: "engine", capacityGal: 500, speedKmh: 25, reloadMin: 0, dropLenM: 0, agent: null, crew: 4, responseH: 0.6 },
  { id: "E-45", name: "Type 1 Engine", group: "engines", kind: "engine", capacityGal: 750, speedKmh: 25, reloadMin: 0, dropLenM: 0, agent: null, crew: 4, responseH: 1 },
  { id: "WT-12", name: "Water Tender", group: "engines", kind: "tender", capacityGal: 2500, speedKmh: 25, reloadMin: 0, dropLenM: 0, agent: null, crew: 2, responseH: 1.5 },
  { id: "C-7", name: "Hotshot Crew", group: "crews", kind: "crew", capacityGal: 0, speedKmh: 2, reloadMin: 0, dropLenM: 0, agent: null, crew: 20, responseH: 4 },
  { id: "C-14", name: "Hand Crew", group: "crews", kind: "crew", capacityGal: 0, speedKmh: 2, reloadMin: 0, dropLenM: 0, agent: null, crew: 20, responseH: 6 },
  { id: "DZ-4", name: "D6 Dozer", group: "crews", kind: "dozer", capacityGal: 0, speedKmh: 3, reloadMin: 0, dropLenM: 0, agent: null, crew: 2, responseH: 3 },
];

const BR_UNITS: UnitSpec[] = [
  { id: "FAB-2853", name: "KC-390 Millennium", group: "air", kind: "vlat", capacityGal: 3170, speedKmh: 600, reloadMin: 35, dropLenM: 1100, agent: "water", crew: 4, responseH: 20 },
  { id: "AT-01", name: "AT-802F Air Tractor", group: "air", kind: "seat", capacityGal: 820, speedKmh: 330, reloadMin: 12, dropLenM: 400, agent: "water", crew: 1, responseH: 4 },
  { id: "AT-02", name: "AT-802F Air Tractor", group: "air", kind: "seat", capacityGal: 820, speedKmh: 330, reloadMin: 12, dropLenM: 400, agent: "water", crew: 1, responseH: 6 },
  { id: "H-36", name: "H-36 Caracal (bucket)", group: "air", kind: "heli", capacityGal: 530, speedKmh: 250, reloadMin: 4, dropLenM: 160, agent: "water", crew: 4, responseH: 12 },
  { id: "AS-350", name: "AS350 Esquilo (bucket)", group: "air", kind: "heli", capacityGal: 140, speedKmh: 200, reloadMin: 3, dropLenM: 90, agent: "water", crew: 2, responseH: 3 },
  { id: "C-98", name: "C-98 Caravan · coordination", group: "air", kind: "airattack", capacityGal: 0, speedKmh: 300, reloadMin: 0, dropLenM: 0, agent: null, crew: 3, responseH: 8 },
  { id: "ABT-21", name: "CBMMS tanker truck", group: "engines", kind: "tender", capacityGal: 1585, speedKmh: 20, reloadMin: 0, dropLenM: 0, agent: null, crew: 4, responseH: 1 },
  { id: "ABT-34", name: "CBMMS tanker truck", group: "engines", kind: "tender", capacityGal: 1585, speedKmh: 20, reloadMin: 0, dropLenM: 0, agent: null, crew: 4, responseH: 2 },
  { id: "VTR-07", name: "4×4 brush truck", group: "engines", kind: "engine", capacityGal: 400, speedKmh: 25, reloadMin: 0, dropLenM: 0, agent: null, crew: 4, responseH: 1.5 },
  { id: "PF-01", name: "Prevfogo/Ibama brigade", group: "crews", kind: "crew", capacityGal: 0, speedKmh: 2, reloadMin: 0, dropLenM: 0, agent: null, crew: 25, responseH: 6 },
  { id: "PF-02", name: "Prevfogo/Ibama brigade", group: "crews", kind: "crew", capacityGal: 0, speedKmh: 2, reloadMin: 0, dropLenM: 0, agent: null, crew: 25, responseH: 12 },
  { id: "ICM-03", name: "ICMBio brigade", group: "crews", kind: "crew", capacityGal: 0, speedKmh: 2, reloadMin: 0, dropLenM: 0, agent: null, crew: 15, responseH: 18 },
  { id: "TR-02", name: "Crawler tractor (firebreak)", group: "crews", kind: "dozer", capacityGal: 0, speedKmh: 3, reloadMin: 0, dropLenM: 0, agent: null, crew: 2, responseH: 10 },
];

export interface Drop {
  unit: string;
  t: number;
  line: [LngLat, LngLat];
  gal: number;
  agent: "retardant" | "water";
}

interface Leg {
  t0: number;
  t1: number;
  from: LngLat;
  to: LngLat;
  phase: "outbound" | "drop" | "return" | "reload" | "orbit";
}

export type UnitStatus = "staged" | "inbound" | "dropping" | "returning" | "reloading" | "supervising" | "cutting" | "patrol" | "protecting" | "grounded";

export interface UnitState {
  spec: UnitSpec;
  pos: LngLat;
  heading: number;
  altAgl: number;
  status: UnitStatus;
  airborne: boolean;
}

const DAY_ALT = 3; // aircraft fly when the sun is >3° above the horizon

export class OpsSim {
  readonly units: UnitSpec[];
  readonly drops: Drop[] = [];
  private legs = new Map<string, Leg[]>();
  readonly first: number;
  readonly end: number;
  private containmentPts: [number, number][];

  constructor(private b: IncidentBundle) {
    this.units = b.meta.fleet === "br" ? BR_UNITS : US_UNITS;
    const passes = passesWithFire(b);
    this.first = passes[0]?.t ?? b.meta.t0_epoch;
    this.end = Date.parse(b.meta.end) / 1000;
    this.containmentPts = this.buildContainment();
    for (const u of this.units) if (u.group === "air" && u.kind !== "airattack") this.scheduleAir(u);
  }

  private isDay(t: number): boolean {
    const [lon, lat] = this.b.meta.center;
    return sunPosition(t, lon, lat).altitude > DAY_ALT;
  }

  private nextDay(t: number): number {
    let x = t;
    while (!this.isDay(x) && x < this.end) x += 600;
    return x;
  }

  private target(t: number, k: number): { hot: LngLat; away: number } | null {
    const hs = activeHotspots(this.b, t).filter((h) => h.status !== "cooling");
    if (!hs.length) return null;
    const h = hs[k % Math.min(hs.length, 3)];
    const g = frontGeometry(this.b, t);
    const c = g.centroid ?? this.b.meta.center;
    // attack the live edge near the tracked hot spot, laying the line just outside it
    const edge = freshestNear(this.b, h.pos, t, 6000) ?? h.pos;
    return { hot: edge, away: bearingDeg(c, edge) };
  }

  private scheduleAir(u: UnitSpec) {
    const base = u.kind === "heli" ? this.b.meta.icp.lonlat : this.b.meta.base.lonlat;
    const legs: Leg[] = [];
    let t = this.first + u.responseH * 3600;
    let k = Math.floor(hash01(u.capacityGal, u.speedKmh) * 3);
    let guard = 0;
    while (t < this.end && guard++ < 4000) {
      if (!this.isDay(t)) {
        t = this.nextDay(t) + hash01(t, u.speedKmh) * 1800;
        continue;
      }
      const tg = this.target(t, k++);
      if (!tg) {
        t += 3600;
        continue;
      }
      // drop line just ahead of the hot spot, perpendicular to the direction of spread
      const ahead = offset(tg.hot, 250 + hash01(t, 1) * 300, tg.away);
      const half = u.dropLenM / 2;
      const a = offset(ahead, half, tg.away + 90);
      const z = offset(ahead, half, tg.away - 90);
      const flyS = (distanceM(base, a) / (u.speedKmh / 3.6)) * 1.15;
      const dropS = Math.max(8, u.dropLenM / (u.speedKmh / 3.6) * 1.6);
      const t1 = t + flyS;
      const t2 = t1 + dropS;
      const t3 = t2 + flyS;
      const t4 = t3 + u.reloadMin * 60;
      legs.push({ t0: t, t1, from: base, to: a, phase: "outbound" });
      legs.push({ t0: t1, t1: t2, from: a, to: z, phase: "drop" });
      legs.push({ t0: t2, t1: t3, from: z, to: base, phase: "return" });
      legs.push({ t0: t3, t1: t4, from: base, to: base, phase: "reload" });
      this.drops.push({ unit: u.id, t: t2, line: [a, z], gal: u.capacityGal, agent: u.agent ?? "water" });
      t = t4;
      if (areaAt(this.b, t) > 0 && areaAt(this.b, t) - areaAt(this.b, t - 24 * 3600) < 0.002 * areaAt(this.b, t)) {
        // fire has stopped growing: stand down the heavies, keep helicopters on hot spots
        if (u.kind !== "heli") break;
      }
    }
    this.legs.set(u.id, legs);
    this.drops.sort((a, b) => a.t - b.t);
  }

  /** Containment (%): anchored to reported values when available, otherwise driven by growth slowing. */
  private buildContainment(): [number, number][] {
    const facts = (this.b.meta.reported.facts ?? []).filter((f) => f.containment != null);
    const pts: [number, number][] = [[this.first + 18 * 3600, 0]];
    if (facts.length) {
      for (const f of facts) pts.push([Date.parse(f.t) / 1000, f.containment!]);
      if (this.b.meta.reported.contained) pts.push([Date.parse(this.b.meta.reported.contained) / 1000 + 12 * 3600, 100]);
    } else {
      // no reported numbers: containment follows the share of the perimeter that stopped moving
      const days = this.b.meta.days;
      let c = 0;
      for (const d of days) {
        if (d.area_ha <= 0) continue;
        const g = d.growth_ha / d.area_ha;
        c = Math.min(95, c + (g < 0.01 ? 9 : g < 0.05 ? 4 : 1));
        pts.push([d.t_end, c]);
      }
    }
    return pts.sort((a, b) => a[0] - b[0]);
  }

  containment(t: number): number {
    const p = this.containmentPts;
    if (t <= p[0][0]) return 0;
    for (let i = 1; i < p.length; i++) {
      if (t <= p[i][0]) {
        const f = (t - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
        return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f;
      }
    }
    // extrapolate the last slope, capped
    const n = p.length;
    if (n >= 2) {
      const slope = (p[n - 1][1] - p[n - 2][1]) / Math.max(1, p[n - 1][0] - p[n - 2][0]);
      return Math.min(100, p[n - 1][1] + slope * (t - p[n - 1][0]));
    }
    return p[n - 1][1];
  }

  containmentAnchored(): boolean {
    return (this.b.meta.reported.facts ?? []).some((f) => f.containment != null);
  }

  personnel(t: number): number {
    if (t < this.first) return 0;
    const h = (t - this.first) / 3600;
    const area = this.b.meta.stats.area_ha;
    const peak = this.b.meta.fleet === "br" ? 60 + 2.2 * Math.sqrt(area) : 400 + 15 * Math.sqrt(area);
    const ramp = 1 - Math.exp(-h / 30);
    const demob = Math.max(0, Math.min(1, (this.containment(t) - 60) / 40));
    return Math.round(peak * ramp * (1 - 0.6 * demob) + 30 * ramp);
  }

  droppedGal(t: number): number {
    let s = 0;
    for (const d of this.drops) {
      if (d.t > t) break;
      s += d.gal;
    }
    return s;
  }

  dropsUntil(t: number): Drop[] {
    const out: Drop[] = [];
    for (const d of this.drops) {
      if (d.t > t) break;
      out.push(d);
    }
    return out;
  }

  airState(u: UnitSpec, t: number): UnitState {
    const base = u.kind === "heli" ? this.b.meta.icp.lonlat : this.b.meta.base.lonlat;
    if (u.kind === "airattack") {
      const on = t > this.first + u.responseH * 3600 && this.isDay(t);
      const g = frontGeometry(this.b, t);
      const c = g.head ?? g.centroid ?? this.b.meta.center;
      const ang = (t / 140) * (180 / Math.PI) * 0.35;
      return on
        ? { spec: u, pos: offset(c, 2600, ang), heading: (ang + 90) % 360, altAgl: 900, status: "supervising", airborne: true }
        : { spec: u, pos: base, heading: 0, altAgl: 0, status: "staged", airborne: false };
    }
    const legs = this.legs.get(u.id) ?? [];
    let lo = 0;
    let hi = legs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (legs[mid].t0 <= t) lo = mid;
      else hi = mid - 1;
    }
    const L = legs[lo];
    if (!L || t < L.t0 || t > L.t1) {
      return { spec: u, pos: base, heading: 0, altAgl: 0, status: t < this.first + u.responseH * 3600 ? "staged" : "grounded", airborne: false };
    }
    const f = (t - L.t0) / Math.max(1, L.t1 - L.t0);
    const pos = lerpLL(L.from, L.to, f);
    const heading = bearingDeg(L.from, L.to);
    if (L.phase === "reload") return { spec: u, pos: base, heading: 0, altAgl: 0, status: "reloading", airborne: false };
    const cruise = u.kind === "heli" ? 150 : 600;
    const dropAlt = u.kind === "heli" ? 45 : u.kind === "vlat" ? 90 : 70;
    let alt = cruise;
    if (L.phase === "drop") alt = dropAlt;
    else {
      // climb out of the base / descend to the drop
      const edge = Math.min(f, 1 - f) * ((L.t1 - L.t0) / 60);
      alt = dropAlt + (cruise - dropAlt) * Math.min(1, edge / 3);
      if (L.phase === "outbound" && f < 0.1) alt = cruise * (f / 0.1);
      if (L.phase === "return" && f > 0.9) alt = cruise * ((1 - f) / 0.1);
    }
    const status: UnitStatus = L.phase === "drop" ? "dropping" : L.phase === "outbound" ? "inbound" : "returning";
    return { spec: u, pos, heading, altAgl: alt, status, airborne: true };
  }

  /** Ground units are spread along the latest perimeter; crews and dozers ride the ends of the line. */
  groundState(u: UnitSpec, t: number, ring: Ring | null, lineEnds: [number, number] | null): UnitState {
    const onScene = t > this.first + u.responseH * 3600;
    const icp = this.b.meta.icp.lonlat;
    if (!onScene || !ring) {
      return { spec: u, pos: offset(icp, 60 + 25 * this.units.indexOf(u), this.units.indexOf(u) * 40), heading: 0, altAgl: 0, status: "staged", airborne: false };
    }
    const idx = this.units.filter((x) => x.group !== "air").indexOf(u);
    let s: number;
    let status: UnitStatus;
    if (u.kind === "crew" || u.kind === "dozer") {
      const [a, z] = lineEnds ?? [0.45, 0.55];
      s = idx % 2 === 0 ? a : z;
      s += (hash01(idx, 5) - 0.5) * 0.01;
      status = "cutting";
    } else {
      s = (0.12 + idx * 0.19 + hash01(Math.floor(t / 7200), idx) * 0.02) % 1;
      status = u.kind === "tender" ? "patrol" : "protecting";
    }
    const pos = ring.at(s);
    const ahead = ring.at(s + 0.002);
    // stand a little outside the perimeter
    const out = offset(pos, 120, bearingDeg(this.b.meta.center, pos));
    return { spec: u, pos: out, heading: bearingDeg(pos, ahead), altAgl: 0, status, airborne: false };
  }
}

/** A perimeter ring with cumulative arc lengths for fast point-at-fraction lookups. */
export class Ring {
  readonly cum: Float64Array;
  readonly total: number;
  constructor(readonly pts: LngLat[]) {
    this.cum = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) this.cum[i] = this.cum[i - 1] + distanceM(pts[i - 1], pts[i]);
    this.total = this.cum[pts.length - 1] || 1;
  }

  at(frac: number): LngLat {
    const target = ((((frac % 1) + 1) % 1)) * this.total;
    let lo = 1;
    let hi = this.pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const d = this.cum[lo] - this.cum[lo - 1];
    return lerpLL(this.pts[lo - 1], this.pts[lo], d ? (target - this.cum[lo - 1]) / d : 0);
  }

  fractionOf(p: LngLat): number {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.pts.length; i++) {
      const dd = distanceM(this.pts[i], p);
      if (dd < bd) {
        bd = dd;
        best = this.cum[i] / this.total;
      }
    }
    return best;
  }

  /** Points from fraction a forward to b (wrapping). */
  sub(a: number, b: number, samples = 200): LngLat[] {
    let span = b - a;
    if (span < 0) span += 1;
    const out: LngLat[] = [];
    for (let i = 0; i <= samples; i++) out.push(this.at(a + (span * i) / samples));
    return out;
  }
}

const ringCache = new WeakMap<object, Ring>();

/** Exterior ring of the largest polygon of the latest perimeter at or before t. */
export function perimeterRing(p: Perimeters, t: number): Ring | null {
  let f: Perimeters["features"][number] | null = null;
  for (const x of p.features) {
    if (x.properties.t - 86400 <= t) f = x;
    else break;
  }
  if (!f) return null;
  const hit = ringCache.get(f);
  if (hit) return hit;
  const g = f.geometry;
  let best: number[][] | null = null;
  const polys = g.type === "Polygon" ? [g.coordinates as number[][][]] : (g.coordinates as number[][][][]);
  for (const poly of polys) if (!best || poly[0].length > best.length) best = poly[0];
  if (!best || best.length < 4) return null;
  const r = new Ring(best as LngLat[]);
  ringCache.set(f, r);
  return r;
}

export interface OpsFrame {
  t: number;
  ring: Ring | null;
  containment: number;
  line: LngLat[] | null; // contained part of the perimeter
  lineKm: number;
  units: UnitState[];
  airUp: number;
  airTotal: number;
  droppedGal: number;
  personnel: number;
}

const heelCache = new WeakMap<Ring, number>();

export function opsAt(sim: OpsSim, b: IncidentBundle, t: number): OpsFrame {
  const ring = perimeterRing(b.perimeters, t);
  const containment = sim.containment(t);
  let line: LngLat[] | null = null;
  let ends: [number, number] | null = null;
  let lineKm = 0;
  if (ring && containment > 0.5) {
    let heel = heelCache.get(ring);
    if (heel === undefined) {
      heel = ring.fractionOf((b.meta.origin as LngLat | null) ?? firstDetection(b));
      heelCache.set(ring, heel);
    }
    const half = Math.min(0.5, containment / 200);
    ends = [heel - half, heel + half];
    line = ring.sub(ends[0], ends[1], Math.max(24, Math.round(240 * half * 2)));
    lineKm = (ring.total * half * 2) / 1000;
  }
  const units = sim.units.map((u) => (u.group === "air" ? sim.airState(u, t) : sim.groundState(u, t, ring, ends)));
  const air = units.filter((u) => u.spec.group === "air");
  return {
    t,
    ring,
    containment,
    line,
    lineKm,
    units,
    airUp: air.filter((u) => u.airborne).length,
    airTotal: air.length,
    droppedGal: sim.droppedGal(t),
    personnel: sim.personnel(t),
  };
}

function firstDetection(b: IncidentBundle): LngLat {
  const d = b.detections;
  return d.lon.length ? [d.lon[0], d.lat[0]] : b.meta.center;
}
