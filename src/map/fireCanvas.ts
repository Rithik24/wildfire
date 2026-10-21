// Paints the fire state at time T from the arrival-time grid into a canvas that MapLibre drapes
// on the terrain (canvas source). One pass over the grid per update, using lookup tables.

import type { Arrival } from "../data/types";

export interface FirePaintOptions {
  time: number;
  t0: number;
  t1: number;
  burned: number; // opacity 0..1 (0 = hidden)
  front: number; // opacity 0..1 (0 = hidden)
  progression: number; // opacity 0..1: colour burned cells by arrival date instead of char
  severity: number; // opacity 0..1: colour burned cells by dNBR class
  night: number; // 0 day .. 1 night (front glows more at night)
  frontWindow: number; // seconds
}

// front colour ramp: fresh (white-yellow) -> orange -> deep red, by age fraction 0..1
// the leading edge glows; most of the 12 h band is already embers
const FRONT_STOPS: [number, number, number, number][] = [
  [0.0, 255, 252, 226],
  [0.04, 255, 228, 110],
  [0.12, 255, 150, 30],
  [0.3, 214, 58, 16],
  [0.6, 120, 30, 16],
  [1.0, 62, 30, 24],
];

// progression ramp (by fraction of the incident window): yellow -> red -> purple -> navy
const PROG_STOPS: [number, number, number, number][] = [
  [0.0, 255, 237, 111],
  [0.2, 254, 178, 76],
  [0.4, 240, 59, 32],
  [0.6, 189, 0, 38],
  [0.8, 122, 1, 119],
  [1.0, 45, 0, 75],
];

function ramp(stops: [number, number, number, number][], n: number): Uint8Array {
  const lut = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    let k = 0;
    while (k < stops.length - 2 && f > stops[k + 1][0]) k++;
    const a = stops[k];
    const b = stops[k + 1];
    const u = (f - a[0]) / (b[0] - a[0] || 1);
    lut[i * 3] = a[1] + (b[1] - a[1]) * u;
    lut[i * 3 + 1] = a[2] + (b[2] - a[2]) * u;
    lut[i * 3 + 2] = a[3] + (b[3] - a[3]) * u;
  }
  return lut;
}

const FRONT_LUT = ramp(FRONT_STOPS, 256);
const PROG_LUT = ramp(PROG_STOPS, 256);

// severity classes (USGS dNBR): low, moderate-low, moderate-high, high
const SEV = [
  { min: -9, rgb: [70, 58, 48] },
  { min: 0.1, rgb: [255, 214, 102] },
  { min: 0.27, rgb: [252, 141, 60] },
  { min: 0.44, rgb: [215, 48, 31] },
  { min: 0.66, rgb: [110, 15, 40] },
];

export class FireCanvas {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  constructor(private arrival: Arrival) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = arrival.width;
    this.canvas.height = arrival.height;
    this.ctx = this.canvas.getContext("2d")!;
    this.img = this.ctx.createImageData(arrival.width, arrival.height);
  }

  paint(o: FirePaintOptions) {
    const { t: arr, severity } = this.arrival;
    const px = this.img.data;
    const n = arr.length;
    const T = o.time;
    const fw = o.frontWindow;
    const span = Math.max(1, o.t1 - o.t0);
    const charA = Math.round(205 * o.burned);
    const frontA = 255 * o.front;
    const glow = 1 + 0.25 * o.night;
    const progA = Math.round(225 * o.progression);
    const sevA = Math.round(230 * o.severity);
    for (let i = 0; i < n; i++) {
      const a = arr[i];
      const j = i * 4;
      if (a > T) {
        px[j + 3] = 0;
        continue;
      }
      const age = T - a;
      if (o.front > 0 && age < fw) {
        const f = age / fw;
        const li = Math.min(255, (f * 255) | 0) * 3;
        px[j] = Math.min(255, FRONT_LUT[li] * glow);
        px[j + 1] = Math.min(255, FRONT_LUT[li + 1] * glow);
        px[j + 2] = FRONT_LUT[li + 2];
        // fresh fire is opaque; older embers let the char/terrain show through a little
        px[j + 3] = frontA * (f < 0.3 ? 1 : 1 - 0.35 * (f - 0.3));
        continue;
      }
      if (progA > 0) {
        const li = Math.min(255, (((a - o.t0) / span) * 255) | 0) * 3;
        px[j] = PROG_LUT[li];
        px[j + 1] = PROG_LUT[li + 1];
        px[j + 2] = PROG_LUT[li + 2];
        px[j + 3] = progA;
        continue;
      }
      if (sevA > 0) {
        const s = severity[i];
        let k = 0;
        if (s === s) while (k < SEV.length - 1 && s >= SEV[k + 1].min) k++;
        const c = SEV[k].rgb;
        px[j] = c[0];
        px[j + 1] = c[1];
        px[j + 2] = c[2];
        px[j + 3] = sevA;
        continue;
      }
      if (charA > 0) {
        // char: darker where the burn was more severe; a faint ember tint for the first day
        const s = severity[i];
        const d = s === s ? Math.min(1, Math.max(0, s / 0.8)) : 0.6;
        const ember = age < fw * 2 ? 1 - (age - fw) / fw : 0;
        px[j] = 52 - 30 * d + 60 * ember;
        px[j + 1] = 40 - 26 * d + 12 * ember;
        px[j + 2] = 34 - 22 * d;
        px[j + 3] = charA;
      } else {
        px[j + 3] = 0;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}

export const PROGRESSION_STOPS = PROG_STOPS;
export const SEVERITY_LEGEND = [
  { label: "Low", rgb: SEV[1].rgb },
  { label: "Moderate-low", rgb: SEV[2].rgb },
  { label: "Moderate-high", rgb: SEV[3].rgb },
  { label: "High", rgb: SEV[4].rgb },
];
