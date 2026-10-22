import { useEffect, useMemo } from "react";
import { useStore, DEFAULT_LAYERS, type Mode, type LayerId } from "../store";
import { useT } from "../i18n";
import { useFmt, type Fmt } from "../lib/format";
import type { IncidentBundle } from "../data/types";
import { frontGeometry } from "../data/analytics";
import type { LngLat } from "../lib/geo";

interface Chapter {
  title: string;
  body: string;
  t: number;
  mode: Mode;
  layers?: Partial<Record<LayerId, boolean>>;
  cam?: { center?: LngLat; zoom?: number; pitch?: number; bearing?: number; bounds?: [number, number, number, number] };
  drone?: string;
  camera?: boolean;
  unit?: string;
  compare?: number | null;
  play?: boolean;
}

function chapters(b: IncidentBundle, fmt: Fmt): Chapter[] {
  const m = b.meta;
  const first = Date.parse(m.stats.first_detection) / 1000;
  const ev = (k: string) => m.events.find((e) => e.kind === k);
  const growth = m.events.find((e) => e.kind === "growth" && e.title.startsWith("Largest")) ?? ev("growth");
  const peak = ev("frp");
  const night = ev("night");
  const end = Date.parse(m.end) / 1000;
  const head = (t: number) => frontGeometry(b, t).head ?? m.center;
  const firstAt: LngLat = [b.detections.lon[0], b.detections.lat[0]];
  const zoomFor = Math.max(9.5, 12.6 - Math.log2(Math.max(1, m.stats.area_ha / 2000)) / 2);
  const reported = m.reported.final_acres ? ` Agencies reported ${fmt.num(m.reported.final_acres)} acres; the satellite reconstruction lands at ${fmt.num(m.stats.area_ha / 0.404686)} acres.` : "";
  const out: Chapter[] = [
    {
      title: m.name,
      body: `${m.region}. This replay is rebuilt from ${fmt.num(m.stats.detections)} VIIRS fire pixels seen on ${m.stats.overpasses_with_fire} satellite overpasses, a Sentinel-2 burn scar and hourly airport weather.${reported}`,
      t: first - 3600,
      mode: "incident",
      cam: { bounds: m.bbox, pitch: 50, bearing: -12 },
    },
    {
      title: "First satellite detection",
      body: `${b.detections.sat[0] === 1 ? "NOAA-20" : b.detections.sat[0] === 2 ? "NOAA-21" : "S-NPP"} sees the fire at ${fmt.dateTime(first)}. White and yellow is fresh fire; it ages to red and then char over 12 hours. Dots are individual 375 m fire pixels.`,
      t: first + 1200,
      mode: "incident",
      cam: { center: firstAt, zoom: zoomFor + 1.6, pitch: 58, bearing: 10 },
    },
  ];
  if (growth) {
    out.push({
      title: "The run",
      body: `${growth.detail}. Watch the front advance between overpasses: timing between looks is interpolated, so it moves smoothly but only the overpasses are measurements.`,
      t: growth.t - 6 * 3600,
      mode: "incident",
      cam: { center: head(growth.t), zoom: zoomFor + 0.4, pitch: 55, bearing: -25 },
      play: true,
    });
  }
  if (peak) {
    out.push({
      title: "Peak fire power",
      body: `${peak.detail}. The FRP chart below sums the radiative power of every fire pixel on each overpass. Smoke drifts with the wind observed at ${b.weather?.station.name.split(",")[0] ?? "the nearest airport"}.`,
      t: peak.t + 300,
      mode: "incident",
      layers: { smoke: true, detections: true },
      cam: { center: head(peak.t), zoom: zoomFor + 0.8, pitch: 62, bearing: 30 },
    });
  }
  if (night) {
    out.push({
      title: "Night-time run",
      body: `${night.detail}. Dry air at night means the fire keeps running while aircraft are grounded: the basemap darkens with the real sun position.`,
      t: night.t,
      mode: "incident",
      cam: { center: head(night.t), zoom: zoomFor + 0.6, pitch: 60, bearing: -40 },
    });
  }
  const droneT = (peak?.t ?? first + 86400) + 4 * 3600;
  out.push({
    title: "Drones on the hot spots",
    body: "A simulated fleet is tasked at every overpass to the strongest hot spots VIIRS is tracking. The camera renders the real arrival-time and severity data as a thermal image: switch palettes or EO.",
    t: droneT,
    mode: "drones",
    drone: "UAV-02",
    camera: true,
    cam: { center: head(droneT), zoom: zoomFor + 1.2, pitch: 60, bearing: 0 },
  });
  // midday after the peak for aircraft
  let air = (peak?.t ?? first) + 86400;
  const off = m.utc_offset_h * 3600;
  air = Math.floor((air + off) / 86400) * 86400 - off + 13 * 3600;
  out.push({
    title: "Rehearsing the response",
    body: "Tankers fly drop cycles from the real air base to the most active front in daylight (red retardant, blue water); crews and dozers cut line from the heel of the fire. Every unit here is simulated.",
    t: Math.min(air, end - 3600),
    mode: "resources",
    unit: m.fleet === "br" ? "AT-01" : "T-131",
    cam: { center: head(air), zoom: zoomFor, pitch: 55, bearing: -20 },
  });
  if (m.method.b_channel === "dnbr") out.push({
    title: "Burn severity",
    body: "After the fire, Sentinel-2 shows how badly each 20–40 m pixel burned (dNBR). Severity only appears once a place has burned on the timeline.",
    t: end - 600,
    mode: "incident",
    layers: { severity: true, detections: false, smoke: false },
    cam: { bounds: m.bbox, pitch: 45, bearing: -12 },
  });
  if (m.imagery) {
    out.push({
      title: "Before and after",
      body: "Slide between the Sentinel-2 images from before and after the fire. Use Analysis → Arrival-time map for the classic progression map, or the daily perimeters.",
      t: end - 600,
      mode: "incident",
      layers: { burned: false, front: false, severity: false, detections: false, smoke: false, s2post: true },
      compare: 0.5,
      cam: { bounds: m.bbox, pitch: 30, bearing: 0 },
    });
  }
  out.push({
    title: "Explore",
    body: "Scrub the timeline, click events, hover the terrain for arrival time and severity, switch incidents from the title. Every number shows where it came from: REAL, DERIVED, REPORTED or SIM. Methods & sources are under ⓘ.",
    t: peak?.t ?? first + 86400,
    mode: "incident",
    layers: {},
    cam: { bounds: m.bbox, pitch: 52, bearing: -12 },
  });
  return out;
}

export function Tour() {
  const idx = useStore((s) => s.tour);
  const b = useStore((s) => s.bundle);
  const t = useT();
  const fmt = useFmt();
  const list = useMemo(() => (b ? chapters(b, fmt) : []), [b, fmt.tzLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (idx == null || !b) return;
    const c = list[idx];
    if (!c) return;
    const st = useStore.getState();
    const layers = structuredClone(DEFAULT_LAYERS);
    for (const [k, v] of Object.entries(c.layers ?? {})) layers[k as LayerId].on = v as boolean;
    st.set({
      mode: c.mode,
      layers,
      compare: c.compare ?? null,
      selectedDrone: c.drone ?? st.selectedDrone,
      cameraOpen: !!c.camera,
      selectedUnit: c.unit ?? null,
      follow: null,
      playing: !!c.play,
      speed: c.play ? 1 : st.speed,
    });
    st.setTime(c.t);
    if (c.cam) st.flyTo({ ...c.cam, duration: 2200 });
  }, [idx, b, list]);

  useEffect(() => {
    if (idx == null) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") useStore.getState().set({ tour: null, playing: false });
      if (e.key === "ArrowRight" && e.altKey) next();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  if (idx == null || !list[idx]) return null;
  const c = list[idx];
  const next = () => useStore.getState().set({ tour: idx + 1 < list.length ? idx + 1 : null });
  return (
    <div className="card tour-card" role="dialog" aria-label="Guided tour">
      <h4>{c.title}</h4>
      <div style={{ color: "var(--text-2)" }}>{c.body}</div>
      <div className="ctr">
        <span className="n">
          {idx + 1} / {list.length} · {fmt.dateTime(c.t)}
        </span>
        <button className="btn sm" onClick={() => useStore.getState().set({ tour: null, playing: false })}>
          {t("exit")}
        </button>
        {idx > 0 && (
          <button className="btn sm" onClick={() => useStore.getState().set({ tour: idx - 1 })}>
            {t("back")}
          </button>
        )}
        <button className="btn sm primary" onClick={next}>
          {idx + 1 < list.length ? t("next") : t("close")}
        </button>
      </div>
    </div>
  );
}
