// Shapes of the incident package written by pipeline/build_incident.py.

export type Prov = "real" | "derived" | "reported" | "external" | "sim";

export interface Pass {
  t: number;
  sat: string;
  n: number;
  frp: number;
  frp_max?: number;
  day: number | null;
  area_ha: number;
}

export interface DayStat {
  date: string;
  t_end: number;
  area_ha: number;
  growth_ha: number;
  advance_km: number;
  bearing: number | null;
  detections: number;
  frp_sum: number;
}

export interface IncidentEvent {
  t: number;
  kind: "detection" | "frp" | "growth" | "night" | "milestone" | "slowing" | "reported" | string;
  title: string;
  detail: string;
  prov: Prov;
  value?: number;
  acres?: number;
  containment?: number;
}

export interface ReportedFact {
  t: string;
  text: string;
  source: string;
  acres?: number;
  containment?: number;
}

export interface IncidentMeta {
  id: string;
  name: string;
  region: string;
  country: string;
  timezone: string;
  utc_offset_h: number;
  bbox: [number, number, number, number];
  center: [number, number];
  origin: [number, number] | null;
  t0: string;
  t0_epoch: number;
  start: string;
  end: string;
  grid: {
    width: number;
    height: number;
    res_m: number;
    corners: [number, number][];
  };
  arrival_step_min: number;
  method: {
    res_m: number;
    scar: string;
    dnbr_min: number;
    nbr_post_max: number | null;
    viirs_only_area_ha: number;
    b_channel: "dnbr" | "frp";
  };
  stats: {
    detections: number;
    overpasses: number;
    overpasses_with_fire: number;
    area_ha: number;
    peak_frp_mw: number;
    first_detection: string;
    last_detection: string;
    hotspots: number;
    satellites: Record<string, number>;
  };
  hourly: { t: number[]; area_ha: number[] };
  passes: Pass[];
  days: DayStat[];
  events: IncidentEvent[];
  reported: {
    final_acres?: number;
    structures_destroyed?: number;
    fatalities?: number;
    contained?: string;
    cause?: string;
    facts?: ReportedFact[];
    sources?: { label: string; url: string }[];
  };
  base: { name: string; lonlat: [number, number] };
  icp: { name: string; lonlat: [number, number] };
  fleet: "us" | "br";
  imagery?: {
    corners: [number, number][];
    res_m: number;
    pre: { window: string[]; scenes: { id: string; date: string; cloud: number }[]; clear_pct: number };
    post: { window: string[]; scenes: { id: string; date: string; cloud: number }[]; clear_pct: number };
    severity_classes: { min_dnbr: number; label: string; color: number[] }[];
  };
}

export interface Detections {
  t: number[]; // minutes since t0
  lon: number[];
  lat: number[];
  frp: number[];
  conf: number[];
  sat: number[];
  day: number[];
}

export interface HotspotObs {
  t: number;
  lon: number;
  lat: number;
  n: number;
  frp: number;
  frp_max: number;
  bt4_max: number;
  sat: string;
}

export interface HotspotTrack {
  id: string;
  obs: HotspotObs[];
  frp_total: number;
  n_total: number;
  t_first: number;
  t_last: number;
}

export interface WeatherHour {
  t: number;
  wspd: number | null;
  wdir: number | null;
  gust: number | null;
  temp: number | null;
  rh: number | null;
}

export interface Weather {
  station: { id: string; name: string; lat: number; lon: number; elev_m: number };
  source: string;
  hourly: WeatherHour[];
  notes: { t: number; kind: string; metar: string }[];
}

export interface Arrival {
  width: number;
  height: number;
  /** arrival time in epoch seconds per cell, Infinity where never burned */
  t: Float64Array;
  /** dNBR (0..1.27) or NaN */
  severity: Float32Array;
  /** sorted arrival times of burned cells (for fast area-at-time lookups) */
  sorted: Float64Array;
  cellHa: number;
}

export interface Perimeters {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
    properties: { date: string; t: number; area_ha: number; growth_ha: number };
  }[];
}

export interface IncidentIndexItem {
  id: string;
  name: string;
  region: string;
  country: string;
  start: string;
  end: string;
  center: [number, number];
  area_ha: number;
  detections: number;
  reported_acres?: number;
  thumb: string | null;
}

export interface IncidentBundle {
  meta: IncidentMeta;
  detections: Detections;
  tracks: HotspotTrack[];
  weather: Weather | null;
  arrival: Arrival;
  perimeters: Perimeters;
  base: string; // URL prefix of the package
}
