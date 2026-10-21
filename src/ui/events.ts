import type { IncidentBundle, Prov } from "../data/types";
import type { Mode } from "../store";
import type { Lang } from "../i18n";
import type { LngLat } from "../lib/geo";
import { getSims } from "../sim/registry";

export interface UiEvent {
  t: number;
  kind: string;
  title: string;
  detail: string;
  prov: Prov;
  major: boolean;
  at?: LngLat;
}

const L = {
  en: {
    detection: "First satellite detection",
    frp: "Peak fire radiative power",
    growth_fast: "Fastest growth between passes",
    growth_day: "Largest daily growth",
    night: "Night-time run",
    milestone: (p: string) => `${p} of the final burned area`,
    slowing: "Growth slows below 1% a day",
    metar_fire: "Airport weather report mentions the fire",
    metar_smoke: "Smoke (FU) reported at the airport",
    hs_new: (id: string) => `${id} detected`,
    hs_up: (id: string) => `${id} intensifying`,
    drop: (u: string) => `${u} drop`,
  },
  pt: {
    detection: "Primeira detecção por satélite",
    frp: "Pico de potência radiativa",
    growth_fast: "Crescimento mais rápido entre passagens",
    growth_day: "Maior crescimento diário",
    night: "Avanço noturno",
    milestone: (p: string) => `${p} da área queimada final`,
    slowing: "Crescimento abaixo de 1% ao dia",
    metar_fire: "Boletim meteorológico do aeroporto cita o incêndio",
    metar_smoke: "Fumaça (FU) registrada no aeroporto",
    hs_new: (id: string) => `${id} detectado`,
    hs_up: (id: string) => `${id} intensificando`,
    drop: (u: string) => `Lançamento ${u}`,
  },
  es: {
    detection: "Primera detección satelital",
    frp: "Máxima potencia radiativa",
    growth_fast: "Crecimiento más rápido entre pasadas",
    growth_day: "Mayor crecimiento diario",
    night: "Avance nocturno",
    milestone: (p: string) => `${p} del área quemada final`,
    slowing: "El crecimiento baja del 1% diario",
    metar_fire: "El parte meteorológico del aeropuerto menciona el incendio",
    metar_smoke: "Humo (FU) reportado en el aeropuerto",
    hs_new: (id: string) => `${id} detectado`,
    hs_up: (id: string) => `${id} se intensifica`,
    drop: (u: string) => `Descarga ${u}`,
  },
};

const cache = new Map<string, UiEvent[]>();

export function eventsForMode(b: IncidentBundle, mode: Mode, lang: Lang): UiEvent[] {
  const key = `${b.meta.id}|${mode}|${lang}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const tr = L[lang];
  let out: UiEvent[] = [];
  if (mode === "incident") {
    for (const e of b.meta.events) {
      let title = e.title;
      if (e.kind === "detection") title = tr.detection;
      else if (e.kind === "frp") title = tr.frp;
      else if (e.kind === "growth") title = e.title.startsWith("Largest") ? `${tr.growth_day}` : tr.growth_fast;
      else if (e.kind === "night") title = tr.night;
      else if (e.kind === "milestone") title = tr.milestone(e.title.split(" ")[0]);
      else if (e.kind === "slowing") title = tr.slowing;
      out.push({ t: e.t, kind: e.kind, title, detail: e.detail, prov: e.prov, major: e.kind !== "night" });
    }
    for (const n of b.weather?.notes ?? []) {
      if (n.kind !== "fire") continue;
      out.push({ t: n.t, kind: "weather", title: tr.metar_fire, detail: n.metar, prov: "real", major: false });
    }
    if (!out.some((e) => e.kind === "weather")) {
      const n = b.weather?.notes.find((x) => x.kind === "fu");
      if (n) out.push({ t: n.t, kind: "weather", title: tr.metar_smoke, detail: n.metar, prov: "real", major: false });
    }
  } else if (mode === "drones") {
    const tracks = [...b.tracks].sort((a, z) => z.frp_total - a.frp_total).slice(0, 40);
    for (const trk of tracks) {
      const o = trk.obs[0];
      out.push({ t: o.t, kind: "hs_new", title: tr.hs_new(trk.id), detail: `${o.n} px · ${Math.round(o.frp)} MW · ${o.sat}`, prov: "real", major: trk.frp_total > 2000, at: [o.lon, o.lat] });
      for (let i = 1; i < trk.obs.length; i++) {
        const a = trk.obs[i - 1];
        const z = trk.obs[i];
        if (z.frp > 1.8 * a.frp && z.frp > 300) {
          out.push({ t: z.t, kind: "hs_up", title: tr.hs_up(trk.id), detail: `${Math.round(a.frp)} → ${Math.round(z.frp)} MW`, prov: "real", major: false, at: [z.lon, z.lat] });
        }
      }
    }
  } else {
    const { ops } = getSims(b);
    out = ops.drops.map((d) => {
      const u = ops.units.find((x) => x.id === d.unit)!;
      return {
        t: d.t,
        kind: d.agent,
        title: `${tr.drop(d.unit)} · ${u.name}`,
        detail: `${d.gal.toLocaleString()} gal ${d.agent}`,
        prov: "sim" as Prov,
        major: d.gal >= 3000,
        at: d.line[0],
      };
    });
  }
  out.sort((a, z) => a.t - z.t);
  cache.set(key, out);
  return out;
}

export function eventColor(kind: string): string {
  switch (kind) {
    case "detection":
      return "#f59f00";
    case "frp":
      return "#e03131";
    case "growth":
    case "night":
      return "#e8590c";
    case "milestone":
      return "#9c36b5";
    case "slowing":
      return "#2f9e44";
    case "reported":
      return "#1c7ed6";
    case "weather":
      return "#0b7285";
    case "hs_new":
      return "#f76707";
    case "hs_up":
      return "#c92a2a";
    case "retardant":
      return "#e03131";
    case "water":
      return "#1c7ed6";
    default:
      return "#868e96";
  }
}
