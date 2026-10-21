import { loadIncident } from "./data/load";
import { DEFAULT_LAYERS, useStore } from "./store";
import type { UrlState } from "./url";
import type { IncidentBundle } from "./data/types";

/** A moment worth opening on: the peak fire-power overpass, else 30 h after the first detection. */
export function defaultTime(b: IncidentBundle): number {
  const pk = b.meta.events.find((e) => e.kind === "frp");
  if (pk) return pk.t + 600;
  return Date.parse(b.meta.stats.first_detection) / 1000 + 30 * 3600;
}

let loadSeq = 0;

export async function selectIncident(id: string, url?: UrlState) {
  const seq = ++loadSeq;
  const st = useStore.getState();
  st.set({ loading: 0, error: null, playing: false, incidentId: id, follow: null, selectedHotspot: null, selectedEvent: null, compare: null });
  try {
    const b = await loadIncident(id, (p) => seq === loadSeq && useStore.getState().set({ loading: p }));
    if (seq !== loadSeq) return;
    const layers = structuredClone(DEFAULT_LAYERS);
    for (const l of url?.on ?? []) layers[l].on = true;
    for (const l of url?.off ?? []) layers[l].on = false;
    useStore.getState().set({
      bundle: b,
      loading: null,
      layers,
      time: url?.t ?? defaultTime(b),
      mode: url?.mode ?? useStore.getState().mode,
      selectedDrone: url?.drone ?? useStore.getState().selectedDrone,
      cameraOpen: !!url?.drone,
      selectedUnit: url?.unit ?? null,
    });
    useStore.getState().setTime(useStore.getState().time);
    if (url?.cam) {
      setTimeout(() => useStore.getState().flyTo({ ...url.cam!, duration: 0 }), 300);
    }
  } catch (e) {
    if (seq === loadSeq) useStore.getState().set({ loading: null, error: (e as Error).message });
  }
}
