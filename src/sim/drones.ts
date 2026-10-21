// Simulated drone fleet working the real fire. Every quantity is a pure function of time:
// tasking is recomputed at each satellite overpass from the hot spots VIIRS tracked, and the
// drones orbit (or patrol) the tasked hot spot, transiting between assignments.

import type { IncidentBundle } from "../data/types";
import { activeHotspots, areaAt, freshestNear, frontGeometry, hotspotAt, passesWithFire } from "../data/analytics";
import { bearingDeg, distanceM, hash01, lerpLL, offset, type LngLat } from "../lib/geo";

export interface DroneSpec {
  id: string;
  name: string;
  kind: "quad" | "vtol" | "hexa";
  model: string;
  cruiseKmh: number;
  altAgl: number; // metres
  orbitM: number;
  enduranceMin: number;
  sensor: string;
  color: string;
}

export const DRONES: DroneSpec[] = [
  { id: "UAV-01", name: "Kestrel", kind: "vtol", model: "Fixed-wing VTOL", cruiseKmh: 95, altAgl: 420, orbitM: 1400, enduranceMin: 240, sensor: "EO/IR · 640×512 LWIR", color: "#e8590c" },
  { id: "UAV-02", name: "Harrier", kind: "quad", model: "Quadcopter", cruiseKmh: 55, altAgl: 120, orbitM: 450, enduranceMin: 45, sensor: "EO/IR · radiometric", color: "#d6336c" },
  { id: "UAV-03", name: "Swift", kind: "quad", model: "Quadcopter", cruiseKmh: 55, altAgl: 150, orbitM: 520, enduranceMin: 45, sensor: "EO/IR · radiometric", color: "#7048e8" },
  { id: "UAV-04", name: "Osprey", kind: "hexa", model: "Heavy hexacopter", cruiseKmh: 60, altAgl: 200, orbitM: 650, enduranceMin: 55, sensor: "EO/IR + LiDAR", color: "#1c7ed6" },
  { id: "UAV-05", name: "Condor", kind: "vtol", model: "Fixed-wing VTOL", cruiseKmh: 100, altAgl: 520, orbitM: 1800, enduranceMin: 300, sensor: "EO/IR · wide-area mapping", color: "#0ca678" },
  { id: "UAV-06", name: "Wren", kind: "quad", model: "Quadcopter", cruiseKmh: 50, altAgl: 90, orbitM: 380, enduranceMin: 40, sensor: "EO/IR · spot-fire watch", color: "#f59f00" },
];

export type DroneStatus = "standby" | "transit" | "on_station" | "patrol" | "swap";

export interface DroneState {
  spec: DroneSpec;
  pos: LngLat;
  altAgl: number;
  heading: number;
  speedKmh: number;
  battery: number;
  flightMin: number;
  linkDbm: number;
  status: DroneStatus;
  target: string | null; // hot-spot id
  targetPos: LngLat | null;
  mission: string;
}

interface Assignment {
  t: number;
  targets: (string | null)[];
}

export class DroneSim {
  readonly epochs: Assignment[] = [];
  readonly launch: number;
  constructor(private b: IncidentBundle) {
    const passes = passesWithFire(b);
    this.launch = (passes[0]?.t ?? b.meta.t0_epoch) + 40 * 60;
    for (const p of passes) {
      if (p.t < this.launch - 3600) continue;
      const hs = activeHotspots(b, p.t + 60).filter((h) => h.status !== "cooling");
      // spread drones over the strongest hot spots, keeping one quad as spot-fire watch at the head
      const targets: (string | null)[] = DRONES.map((_, i) => hs[i % Math.max(1, Math.min(hs.length, 5))]?.id ?? null);
      if (hs.length === 0) targets.fill(null);
      this.epochs.push({ t: Math.max(p.t, this.launch), targets });
    }
  }

  private epochIndex(t: number): number {
    let lo = 0;
    let hi = this.epochs.length - 1;
    if (hi < 0 || t < this.epochs[0].t) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.epochs[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private center(id: string | null, t: number, i: number): LngLat {
    if (id) {
      const tr = this.b.tracks.find((x) => x.id === id);
      const s = tr && hotspotAt(tr, t);
      // orbit the live edge of the hot spot, not its (lagging) satellite centroid
      if (s) return freshestNear(this.b, s.pos, t, 6000) ?? s.pos;
    }
    const g = frontGeometry(this.b, t);
    const c = g.head ?? g.centroid ?? (this.b.meta.origin as LngLat | null) ?? this.b.meta.center;
    // spread patrolling drones around the fire
    const r = Math.sqrt(Math.max(areaAt(this.b, t), 100) * 1e4) * 0.35;
    return offset(c, r, (i * 60 + 15) % 360);
  }

  state(t: number, i: number): DroneState {
    const spec = DRONES[i];
    const icp = this.b.meta.icp.lonlat;
    const ph = hash01(i, 7) * Math.PI * 2;
    if (t < this.launch) {
      return {
        spec, pos: offset(icp, 30 + i * 12, i * 60), altAgl: 0, heading: 0, speedKmh: 0, battery: 100, flightMin: 0,
        linkDbm: -38, status: "standby", target: null, targetPos: null, mission: "Standby at staging",
      };
    }
    const k = this.epochIndex(t);
    const cur = this.epochs[k];
    const prev = k > 0 ? this.epochs[k - 1] : null;
    const tid = cur?.targets[i] ?? null;
    const c1 = this.center(tid, t, i);
    const c0 = prev ? this.center(prev.targets[i], cur.t, i) : icp;
    const orbitR = spec.orbitM * (0.85 + 0.3 * hash01(i, 3));
    const vOrbit = (spec.cruiseKmh / 3.6) * (spec.kind === "vtol" ? 0.9 : 0.35);
    const omega = vOrbit / orbitR; // rad/s
    const ang = ph + omega * (t - this.launch);
    const orbitPt = offset(c1, orbitR, (ang * 180) / Math.PI);
    const transitDist = distanceM(c0, orbitPt);
    const transitS = transitDist / (spec.cruiseKmh / 3.6);
    const since = t - (cur?.t ?? this.launch);
    let pos: LngLat;
    let heading: number;
    let speed: number;
    let status: DroneStatus = tid ? "on_station" : "patrol";
    if (since < transitS && transitDist > 200) {
      const f = since / transitS;
      pos = lerpLL(c0, orbitPt, f);
      heading = bearingDeg(c0, orbitPt);
      speed = spec.cruiseKmh;
      status = "transit";
    } else {
      pos = orbitPt;
      heading = (bearingDeg(c1, orbitPt) + 90) % 360;
      speed = vOrbit * 3.6;
    }
    const endS = spec.enduranceMin * 60;
    const cyc = (t - this.launch + hash01(i, 11) * endS) % endS;
    const battery = 100 - (cyc / endS) * 82;
    const swapping = cyc > endS - 120;
    if (swapping) status = "swap";
    const dKm = distanceM(pos, icp) / 1000;
    const alt = spec.altAgl * (1 + 0.04 * Math.sin(t / 97 + i));
    return {
      spec,
      pos,
      altAgl: alt,
      heading,
      speedKmh: swapping ? 0 : speed,
      battery,
      flightMin: cyc / 60,
      linkDbm: Math.round(-42 - 18 * Math.log10(1 + dKm) - 4 * hash01(Math.floor(t / 60), i)),
      status,
      target: tid,
      targetPos: tid ? c1 : null,
      mission: tid ? "Orbit · hot-spot watch" : "Perimeter patrol",
    };
  }

  all(t: number): DroneState[] {
    return DRONES.map((_, i) => this.state(t, i));
  }
}
