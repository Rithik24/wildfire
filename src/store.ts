import { create } from "zustand";
import type { IncidentBundle, IncidentIndexItem } from "./data/types";
import type { Lang } from "./i18n";

export type Mode = "incident" | "drones" | "resources";

export type LayerId =
  | "terrain"
  | "imagery"
  | "s2pre"
  | "s2post"
  | "burned"
  | "front"
  | "detections"
  | "perimeters"
  | "progression"
  | "severity"
  | "hotspots"
  | "smoke"
  | "wind"
  | "ops"
  | "labels";

export interface LayerState {
  on: boolean;
  opacity: number;
}

export const DEFAULT_LAYERS: Record<LayerId, LayerState> = {
  terrain: { on: true, opacity: 1 },
  imagery: { on: true, opacity: 1 },
  s2pre: { on: true, opacity: 1 },
  s2post: { on: false, opacity: 1 },
  burned: { on: true, opacity: 0.85 },
  front: { on: true, opacity: 1 },
  detections: { on: true, opacity: 0.9 },
  perimeters: { on: false, opacity: 0.9 },
  progression: { on: false, opacity: 0.75 },
  severity: { on: false, opacity: 0.8 },
  hotspots: { on: true, opacity: 1 },
  smoke: { on: true, opacity: 0.7 },
  wind: { on: true, opacity: 1 },
  ops: { on: true, opacity: 1 },
  labels: { on: false, opacity: 1 },
};

export interface Hover {
  x: number;
  y: number;
  lon: number;
  lat: number;
  elev: number | null;
  arrival: number | null;
  severity: number | null;
}

export interface CameraRequest {
  center?: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  bounds?: [number, number, number, number];
  duration?: number;
  id: number;
}

interface State {
  index: IncidentIndexItem[];
  worldPath: string | null;
  liveUpdated: string | null;
  pickerTab: "live" | "archive";
  incidentId: string | null;
  bundle: IncidentBundle | null;
  loading: number | null;
  error: string | null;

  time: number;
  playing: boolean;
  speed: number; // simulated hours per real second

  mode: Mode;
  layers: Record<LayerId, LayerState>;
  view3d: boolean;
  exaggeration: number;
  compare: number | null; // before/after mix 0..1 when comparing

  selectedDrone: string | null;
  cameraOpen: boolean;
  follow: string | null; // id of a drone or unit the camera follows
  selectedUnit: string | null;
  selectedEvent: number | null;
  selectedHotspot: string | null;

  units: "metric" | "imperial";
  tz: "local" | "utc";
  lang: Lang;
  theme: "light" | "dark";

  hover: Hover | null;
  toast: string | null;
  panel: "about" | "live" | "incidents" | null;
  tour: number | null;
  sheetOpen: boolean;
  camera: CameraRequest | null;

  set: (p: Partial<State>) => void;
  setTime: (t: number) => void;
  setLayer: (id: LayerId, p: Partial<LayerState>) => void;
  flyTo: (c: Omit<CameraRequest, "id">) => void;
  showToast: (msg: string) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => ({
  index: [],
  worldPath: null,
  liveUpdated: null,
  pickerTab: "archive",
  incidentId: null,
  bundle: null,
  loading: null,
  error: null,

  time: 0,
  playing: false,
  speed: 3,

  mode: "incident",
  layers: structuredClone(DEFAULT_LAYERS),
  view3d: true,
  exaggeration: 1.6,
  compare: null,

  selectedDrone: null,
  cameraOpen: false,
  follow: null,
  selectedUnit: null,
  selectedEvent: null,
  selectedHotspot: null,

  units: "metric",
  tz: "local",
  lang: "en",
  theme: "light",

  hover: null,
  toast: null,
  panel: null,
  tour: null,
  sheetOpen: false,
  camera: null,

  set: (p) => set(p),
  setTime: (t) => {
    const b = get().bundle;
    if (!b) return set({ time: t });
    const lo = Date.parse(b.meta.t0) / 1000;
    const hi = Date.parse(b.meta.end) / 1000;
    set({ time: Math.min(hi, Math.max(lo, t)) });
  },
  setLayer: (id, p) => set((s) => ({ layers: { ...s.layers, [id]: { ...s.layers[id], ...p } } })),
  flyTo: (c) => set({ camera: { ...c, id: Date.now() + Math.random() } }),
  showToast: (msg) => {
    clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 3200);
  },
}));

/** Time quantised to `step` seconds: lets panels re-render a few times per simulated hour, not every frame. */
export function useQuantTime(step = 600): number {
  return useStore((s) => Math.floor(s.time / step) * step);
}

export function timeRange(b: IncidentBundle): [number, number] {
  return [Date.parse(b.meta.t0) / 1000, Date.parse(b.meta.end) / 1000];
}

// Diagnostic handle used by scripts/e2e.mjs and handy in the console.
(window as unknown as { __store: typeof useStore }).__store = useStore;
