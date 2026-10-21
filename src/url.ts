// Deep links: the URL carries the incident, instant, mode, selection, layers and camera, so a
// shared link opens exactly the same view.

import type maplibregl from "maplibre-gl";
import { DEFAULT_LAYERS, useStore, type LayerId, type Mode } from "./store";
import type { Lang } from "./i18n";

export interface UrlState {
  incident?: string;
  t?: number;
  mode?: Mode;
  lang?: Lang;
  units?: "metric" | "imperial";
  tz?: "local" | "utc";
  theme?: "light" | "dark";
  drone?: string;
  unit?: string;
  on?: LayerId[];
  off?: LayerId[];
  cam?: { center: [number, number]; zoom: number; pitch: number; bearing: number };
  tour?: boolean;
}

export function readUrl(): UrlState {
  const q = new URLSearchParams(location.search);
  const out: UrlState = {};
  const inc = q.get("incident");
  if (inc) out.incident = inc;
  const t = q.get("t");
  if (t) {
    const v = /^\d+$/.test(t) ? Number(t) : Date.parse(t) / 1000;
    if (Number.isFinite(v)) out.t = v;
  }
  const mode = q.get("mode");
  if (mode === "incident" || mode === "drones" || mode === "resources") out.mode = mode;
  const lang = q.get("lang");
  if (lang === "en" || lang === "pt" || lang === "es") out.lang = lang;
  const units = q.get("units");
  if (units === "metric" || units === "imperial") out.units = units;
  const tz = q.get("tz");
  if (tz === "local" || tz === "utc") out.tz = tz;
  const theme = q.get("theme");
  if (theme === "light" || theme === "dark") out.theme = theme;
  const drone = q.get("drone");
  if (drone) out.drone = drone;
  const unit = q.get("unit");
  if (unit) out.unit = unit;
  const valid = (x: string): x is LayerId => x in DEFAULT_LAYERS;
  const on = q.get("on");
  if (on) out.on = on.split(",").filter(valid);
  const off = q.get("off");
  if (off) out.off = off.split(",").filter(valid);
  const cam = q.get("cam");
  if (cam) {
    const p = cam.split(",").map(Number);
    if (p.length === 5 && p.every(Number.isFinite)) out.cam = { center: [p[0], p[1]], zoom: p[2], pitch: p[3], bearing: p[4] };
  }
  if (q.has("tour")) out.tour = true;
  return out;
}

export function shareUrl(): string {
  const s = useStore.getState();
  const q = new URLSearchParams();
  if (s.incidentId) q.set("incident", s.incidentId);
  q.set("t", new Date(Math.round(s.time) * 1000).toISOString().slice(0, 16) + "Z");
  if (s.mode !== "incident") q.set("mode", s.mode);
  if (s.lang !== "en") q.set("lang", s.lang);
  if (s.units !== "metric") q.set("units", s.units);
  if (s.tz !== "local") q.set("tz", s.tz);
  if (s.theme !== "light") q.set("theme", s.theme);
  if (s.mode === "drones" && s.selectedDrone) q.set("drone", s.selectedDrone);
  if (s.mode === "resources" && s.selectedUnit) q.set("unit", s.selectedUnit);
  const on: string[] = [];
  const off: string[] = [];
  for (const [id, v] of Object.entries(s.layers)) {
    const d = DEFAULT_LAYERS[id as LayerId];
    if (v.on && !d.on) on.push(id);
    if (!v.on && d.on) off.push(id);
  }
  if (on.length) q.set("on", on.join(","));
  if (off.length) q.set("off", off.join(","));
  const map = (window as unknown as { __map?: maplibregl.Map }).__map;
  if (map) {
    const c = map.getCenter();
    q.set("cam", [c.lng.toFixed(4), c.lat.toFixed(4), map.getZoom().toFixed(2), map.getPitch().toFixed(0), map.getBearing().toFixed(0)].join(","));
  }
  return `${location.origin}${location.pathname}?${q.toString()}`;
}

/** Keep the address bar in sync (without the camera, to avoid churn) so reload keeps the place. */
export function syncUrl() {
  const s = useStore.getState();
  if (!s.incidentId) return;
  const q = new URLSearchParams(location.search);
  q.set("incident", s.incidentId);
  q.set("t", new Date(Math.round(s.time / 60) * 60 * 1000).toISOString().slice(0, 16) + "Z");
  if (s.mode !== "incident") q.set("mode", s.mode);
  else q.delete("mode");
  if (s.lang !== "en") q.set("lang", s.lang);
  else q.delete("lang");
  q.delete("cam");
  q.delete("tour");
  history.replaceState(null, "", `${location.pathname}?${q.toString()}`);
}
