import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { getSims } from "../sim/registry";
import type { IncidentBundle } from "../data/types";
import { freshestNear, lngLatToGrid } from "../data/analytics";
import { daylight } from "../lib/sun";
import { compass, fmtLatLon, offset } from "../lib/geo";
import { Icon } from "./icons";
import { useFmt } from "../lib/format";

type Palette = "ironbow" | "whitehot" | "blackhot" | "eo";

const W = 320;
const H = 200;

function makePalette(stops: [number, number, number, number][]): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const f = i / 255;
    let k = 0;
    while (k < stops.length - 2 && f > stops[k + 1][0]) k++;
    const a = stops[k];
    const b = stops[k + 1];
    const u = (f - a[0]) / (b[0] - a[0] || 1);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * u;
  }
  return lut;
}

const LUTS: Record<Exclude<Palette, "eo">, Uint8Array> = {
  ironbow: makePalette([
    [0, 0, 0, 12],
    [0.15, 32, 0, 90],
    [0.35, 140, 0, 150],
    [0.55, 225, 60, 40],
    [0.75, 255, 160, 0],
    [0.9, 255, 230, 90],
    [1, 255, 255, 240],
  ]),
  whitehot: makePalette([
    [0, 10, 10, 10],
    [1, 255, 255, 255],
  ]),
  blackhot: makePalette([
    [0, 245, 245, 245],
    [1, 5, 5, 5],
  ]),
};

interface ImgSampler {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

const imgCache = new WeakMap<IncidentBundle, Promise<{ pre: ImgSampler | null; post: ImgSampler | null }>>();

function loadImagery(b: IncidentBundle) {
  let p = imgCache.get(b);
  if (!p) {
    const one = async (name: string): Promise<ImgSampler | null> => {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = b.base + name + b.version;
        await img.decode();
        const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
      } catch {
        return null;
      }
    };
    p = Promise.all([one("s2_pre.jpg"), one("s2_post.jpg")]).then(([pre, post]) => ({ pre, post }));
    imgCache.set(b, p);
  }
  return p;
}

function hash(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export function DroneCam() {
  const b = useStore((s) => s.bundle)!;
  const sel = useStore((s) => s.selectedDrone);
  const open = useStore((s) => s.cameraOpen);
  const mode = useStore((s) => s.mode);
  const fmt = useFmt();
  const [pal, setPal] = useState<Palette>("ironbow");
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  const imgs = useRef<{ pre: ImgSampler | null; post: ImgSampler | null } | null>(null);

  useEffect(() => {
    loadImagery(b).then((x) => (imgs.current = x));
  }, [b]);

  useEffect(() => {
    if (!open || !sel || mode !== "drones") return;
    const canvas = cv.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    const px = img.data;
    const hudCanvas = document.createElement("canvas");
    let raf = 0;
    let last = 0;
    const { drones } = getSims(b);
    const di = drones.all(0).findIndex((d) => d.spec.id === sel);
    const { width: gw, height: gh, t: arr, severity } = b.arrival;
    const im = b.meta.imagery;
    const imgCorner = im?.corners;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 60) return;
      last = now;
      const T = useStore.getState().time;
      const d = drones.state(T, di);
      const center = freshestNear(b, d.targetPos ?? d.pos, T, 2500) ?? d.targetPos ?? d.pos;
      const day = daylight(T, b.meta.center[0], b.meta.center[1]);
      // ground footprint across the image: a wide oblique-equivalent view, narrowed by the zoom buttons
      const footprint = Math.max(2400, Math.min(12000, (d.altAgl || 150) * 22)) / zoom;
      const mpp = footprint / W;
      const hd = (d.heading * Math.PI) / 180;
      const cosH = Math.cos(hd);
      const sinH = Math.sin(hd);
      // corners of the view in grid pixel space via two basis vectors
      const c0 = lngLatToGrid(b, center[0], center[1]);
      const east = offset(center, 1000, 90);
      const north = offset(center, 1000, 0);
      const ge = lngLatToGrid(b, east[0], east[1]);
      const gn = lngLatToGrid(b, north[0], north[1]);
      const ex = [(ge[0] - c0[0]) / 1000, (ge[1] - c0[1]) / 1000];
      const nx = [(gn[0] - c0[0]) / 1000, (gn[1] - c0[1]) / 1000];
      // imagery sampler basis
      const sampler = T < Date.parse(b.meta.end) / 1000 - 86400 ? imgs.current?.pre : imgs.current?.post;
      let ic0: [number, number] | null = null;
      let iex = [0, 0];
      let inx = [0, 0];
      if (sampler && imgCorner) {
        const toImg = (lon: number, lat: number): [number, number] => {
          const my = (y: number) => Math.log(Math.tan(Math.PI / 4 + (y * Math.PI) / 360));
          const u = (lon - imgCorner[0][0]) / (imgCorner[1][0] - imgCorner[0][0]);
          const v = (my(imgCorner[0][1]) - my(lat)) / (my(imgCorner[0][1]) - my(imgCorner[3][1]));
          return [u * sampler.w, v * sampler.h];
        };
        ic0 = toImg(center[0], center[1]);
        const ie = toImg(east[0], east[1]);
        const inn = toImg(north[0], north[1]);
        iex = [(ie[0] - ic0[0]) / 1000, (ie[1] - ic0[1]) / 1000];
        inx = [(inn[0] - ic0[0]) / 1000, (inn[1] - ic0[1]) / 1000];
      }
      const bgBase = day > 0.5 ? 0.18 : 0.06;
      let maxTemp = 0;
      let maxX = 0;
      let maxY = 0;
      const lut = pal === "eo" ? null : LUTS[pal];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          // screen -> ground metres (heading up)
          const sx = (x - W / 2) * mpp;
          const sy = (H / 2 - y) * mpp;
          const gxm = sx * cosH + sy * sinH; // east
          const gym = -sx * sinH + sy * cosH; // north
          const gx = c0[0] + ex[0] * gxm + nx[0] * gym;
          const gy = c0[1] + ex[1] * gxm + nx[1] * gym;
          const ix = Math.round(gx + (hash(x, y) - 0.5) * 0.9) | 0; // dithered sampling hides the grid
          const iy = Math.round(gy + (hash(y, x) - 0.5) * 0.9) | 0;
          let temp = 0; // 0..1 scene temperature index
          let tex = 0.5;
          let ir = 0, ig = 0, ib = 0;
          if (sampler && ic0) {
            const qx = (ic0[0] + iex[0] * gxm + inx[0] * gym) | 0;
            const qy = (ic0[1] + iex[1] * gxm + inx[1] * gym) | 0;
            if (qx >= 0 && qy >= 0 && qx < sampler.w && qy < sampler.h) {
              const k = (qy * sampler.w + qx) * 4;
              ir = sampler.data[k];
              ig = sampler.data[k + 1];
              ib = sampler.data[k + 2];
              tex = (ir + ig + ib) / 765;
            }
          }
          const n = hash(x + Math.floor(sx / 50), y + Math.floor(sy / 50)) * 0.04;
          let fireGlow = 0;
          if (ix >= 0 && iy >= 0 && ix < gw && iy < gh) {
            const a = arr[iy * gw + ix];
            const age = T - a;
            if (age >= 0) {
              const sev = severity[iy * gw + ix];
              const s = sev === sev ? Math.min(1, Math.max(0.2, sev / 0.7)) : 0.6;
              if (age < 2 * 3600) {
                temp = 0.92 + 0.08 * hash(x, y + (T / 30) | 0);
                fireGlow = 1;
              } else if (age < 12 * 3600) {
                // smouldering: hotter where the burn was severe, patchy with the fuel texture
                const f = (age - 7200) / (10 * 3600);
                temp = (0.82 - 0.45 * f) * (0.55 + 0.45 * s) + 0.18 * (tex - 0.4) + 0.1 * hash(x * 3, y * 3);
                fireGlow = (1 - f) * s;
              } else if (age < 96 * 3600) {
                const f = (age - 12 * 3600) / (84 * 3600);
                temp = (0.36 - 0.2 * f) * (0.45 + 0.55 * s) + 0.12 * (tex - 0.4) + 0.05 * hash(x * 7, y * 5);
                // smouldering logs and stumps: sparse hot spots that persist for days (mop-up targets)
                const cellHash = hash(ix * 1.7, iy * 3.1);
                if (cellHash < 0.07 * s * (1 - f)) temp = Math.max(temp, 0.62 + 0.3 * hash(ix, iy) * (1 - f));
              } else {
                temp = bgBase + 0.05 * s;
              }
            } else {
              temp = bgBase + tex * 0.12 * (day > 0.5 ? 1 : 0.4);
            }
          } else {
            temp = bgBase + tex * 0.12 * (day > 0.5 ? 1 : 0.4);
          }
          temp = Math.min(1, temp + n);
          if (temp > maxTemp) {
            maxTemp = temp;
            maxX = x;
            maxY = y;
          }
          const k = (y * W + x) * 4;
          if (lut) {
            const li = Math.min(255, (temp * 255) | 0) * 3;
            px[k] = lut[li];
            px[k + 1] = lut[li + 1];
            px[k + 2] = lut[li + 2];
          } else {
            // EO: imagery, charred where burned, flame glow at the front, dimmed at night
            const night = 1 - day;
            let r = ir || 70, g = ig || 70, bl = ib || 60;
            if (ix >= 0 && iy >= 0 && ix < gw && iy < gh && T - arr[iy * gw + ix] >= 0) {
              r = r * 0.35 + 20;
              g = g * 0.3 + 15;
              bl = bl * 0.3 + 12;
            }
            const lum = 0.25 + 0.75 * day;
            r = r * lum + fireGlow * 255 * (0.6 + 0.4 * night);
            g = g * lum + fireGlow * 120 * (0.6 + 0.4 * night);
            bl = bl * lum + fireGlow * 20;
            px[k] = r;
            px[k + 1] = g;
            px[k + 2] = bl;
          }
          px[k + 3] = 255;
        }
      }
      // HUD drawn at display resolution
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth * dpr;
      const ch = canvas.clientHeight * dpr;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      hudCanvas.width = W;
      hudCanvas.height = H;
      hudCanvas.getContext("2d")!.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(hudCanvas, 0, 0, cw, ch);
      const s = ch / 300;
      ctx.save();
      ctx.scale(s, s);
      const vw = cw / s;
      const vh = 300;
      const green = pal === "eo" ? "#9cff9c" : "#e9fbe9";
      ctx.strokeStyle = green;
      ctx.fillStyle = green;
      ctx.lineWidth = 1;
      ctx.font = `600 11px "JetBrains Mono", monospace`;
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = 3;
      // crosshair
      const cx = vw / 2;
      const cy = vh / 2;
      ctx.beginPath();
      ctx.moveTo(cx - 22, cy);
      ctx.lineTo(cx - 7, cy);
      ctx.moveTo(cx + 7, cy);
      ctx.lineTo(cx + 22, cy);
      ctx.moveTo(cx, cy - 22);
      ctx.lineTo(cx, cy - 7);
      ctx.moveTo(cx, cy + 7);
      ctx.lineTo(cx, cy + 22);
      ctx.stroke();
      // corner brackets
      for (const [x0, y0, dx, dy] of [
        [14, 14, 1, 1],
        [vw - 14, 14, -1, 1],
        [14, vh - 14, 1, -1],
        [vw - 14, vh - 14, -1, -1],
      ]) {
        ctx.beginPath();
        ctx.moveTo(x0, y0 + 16 * dy);
        ctx.lineTo(x0, y0);
        ctx.lineTo(x0 + 16 * dx, y0);
        ctx.stroke();
      }
      // heading tape
      ctx.textAlign = "center";
      for (let k = -40; k <= 40; k += 10) {
        const hdg = Math.round(d.heading / 10) * 10 + k;
        const x = cx + (hdg - d.heading) * 3;
        if (x < 60 || x > vw - 60) continue;
        ctx.fillRect(x, 26, 1, hdg % 30 === 0 ? 7 : 4);
        if (hdg % 30 === 0) ctx.fillText(compass(((hdg % 360) + 360) % 360), x, 45);
      }
      ctx.fillText(`${String(Math.round(d.heading)).padStart(3, "0")}°`, cx, 20);
      // hottest point box
      if (pal !== "eo" && maxTemp > 0.6) {
        const hx = (maxX / W) * vw;
        const hy = (maxY / H) * vh;
        ctx.strokeStyle = "#ff6b6b";
        ctx.strokeRect(hx - 14, hy - 14, 28, 28);
        ctx.fillStyle = "#ff6b6b";
        ctx.textAlign = "left";
        ctx.fillText(`MAX ${Math.round(30 + maxTemp * 870)}°C*`, hx + 18, hy + 4);
      }
      ctx.fillStyle = green;
      ctx.textAlign = "left";
      ctx.fillText(`${d.spec.id} · ${d.spec.name.toUpperCase()}`, 22, 70);
      ctx.fillText(`${pal === "eo" ? "EO" : `IR ${pal.toUpperCase()}`} · ${Math.round(footprint)} m FOV`, 22, 86);
      ctx.fillText(`ALT ${fmt.alt(d.altAgl)} AGL`, 22, vh - 54);
      ctx.fillText(`GS  ${fmt.speed(d.speedKmh)}`, 22, vh - 38);
      ctx.fillText(fmtLatLon(center[0], center[1]), 22, vh - 22);
      ctx.textAlign = "right";
      ctx.fillText(`${new Date(T * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`, vw - 22, 70);
      ctx.fillText(`BAT ${Math.round(d.battery)}%`, vw - 22, vh - 38);
      ctx.fillText(`LNK ${d.linkDbm} dBm`, vw - 22, vh - 22);
      if (d.target) ctx.fillText(`TGT ${d.target}`, vw - 22, 86);
      ctx.fillStyle = "#ff4d4d";
      ctx.beginPath();
      ctx.arc(vw - 30, vh - 64, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = green;
      ctx.fillText("SIM", vw - 40, vh - 60);
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [b, sel, open, mode, pal, zoom, fmt]);

  if (!open || !sel || mode !== "drones") return null;
  return (
    <div className={`cam ${full ? "full" : ""}`}>
      <canvas ref={cv} />
      <div className="cam-bar">
        <b>{sel}</b>
        <div className="seg" role="group" aria-label="Palette">
          {(["eo", "ironbow", "whitehot", "blackhot"] as Palette[]).map((p) => (
            <button key={p} className={pal === p ? "on" : ""} onClick={() => setPal(p)}>
              {p === "eo" ? "EO" : p === "ironbow" ? "IR" : p === "whitehot" ? "WH" : "BH"}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Zoom">
          {[1, 2, 4].map((z) => (
            <button key={z} className={zoom === z ? "on" : ""} onClick={() => setZoom(z)}>
              {z}×
            </button>
          ))}
        </div>
        <span className="chip sim">SIM</span>
        <div className="x">
          <button onClick={() => setFull((f) => !f)} aria-label="Toggle full view">
            <Icon name={full ? "min" : "max"} size={14} />
          </button>
          <button onClick={() => useStore.getState().set({ cameraOpen: false })} aria-label="Close camera">
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
