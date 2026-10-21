import type {
  Arrival,
  Detections,
  HotspotTrack,
  IncidentBundle,
  IncidentIndexItem,
  IncidentMeta,
  Perimeters,
  Weather,
} from "./types";

const DATA = "data/";

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export async function loadIndex(): Promise<IncidentIndexItem[]> {
  const idx = await json<{ incidents: IncidentIndexItem[] }>(DATA + "index.json");
  return idx.incidents;
}

/** Decode arrival.png: R,G = uint16 arrival step since t0 (65535 = never), B = dNBR or FRP class. */
async function loadArrival(url: string, meta: IncidentMeta): Promise<Arrival> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  // createImageBitmap with premultiply "none" keeps the exact channel bytes
  const bmp = await createImageBitmap(img, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const t = new Float64Array(n);
  const sev = new Float32Array(n);
  const step = meta.arrival_step_min * 60;
  const t0 = meta.t0_epoch;
  let burned = 0;
  for (let i = 0; i < n; i++) {
    const v = (px[i * 4] << 8) | px[i * 4 + 1];
    if (v === 65535) {
      t[i] = Infinity;
    } else {
      t[i] = t0 + v * step;
      burned++;
    }
    const b = px[i * 4 + 2];
    sev[i] = meta.method.b_channel === "dnbr" ? (b === 255 ? NaN : (b / 254) * 1.27) : NaN;
  }
  const sorted = new Float64Array(burned);
  let k = 0;
  for (let i = 0; i < n; i++) if (t[i] !== Infinity) sorted[k++] = t[i];
  sorted.sort();
  const cellHa = (meta.grid.res_m * meta.grid.res_m) / 1e4;
  return { width: w, height: h, t, severity: sev, sorted, cellHa };
}

export async function loadIncident(id: string, onProgress?: (p: number) => void): Promise<IncidentBundle> {
  const base = `${DATA}${id}/`;
  const meta = await json<IncidentMeta>(base + "incident.json");
  onProgress?.(0.2);
  let done = 0;
  const tick = <T,>(p: Promise<T>) =>
    p.then((v) => {
      done++;
      onProgress?.(0.2 + (0.8 * done) / 5);
      return v;
    });
  const [detections, hot, weather, arrival, perimeters] = await Promise.all([
    tick(json<Detections>(base + "detections.json")),
    tick(json<{ tracks: HotspotTrack[] }>(base + "hotspots.json")),
    tick(json<Weather>(base + "weather.json").catch(() => null)),
    tick(loadArrival(base + "arrival.png", meta)),
    tick(json<Perimeters>(base + "perimeters.json")),
  ]);
  return { meta, detections, tracks: hot.tracks, weather, arrival, perimeters, base };
}
