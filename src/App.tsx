import { useEffect } from "react";
import { useStore, timeRange, type Mode } from "./store";
import { useT } from "./i18n";
import { TopBar } from "./ui/TopBar";
import { RightPanel } from "./ui/RightPanel";
import { Dock } from "./ui/Dock";
import { MapView } from "./map/MapView";
import { Modals } from "./ui/Modals";
import { Tour } from "./ui/Tour";
import { loadIndex } from "./data/load";
import { selectIncident } from "./app-actions";
import { readUrl, syncUrl } from "./url";
import { passesWithFire } from "./data/analytics";

function usePlayback() {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useStore.getState();
      if (s.playing && s.bundle) {
        const [, t1] = timeRange(s.bundle);
        const next = s.time + dt * s.speed * 3600;
        if (next >= t1) {
          s.setTime(t1);
          s.set({ playing: false });
        } else s.setTime(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const s = useStore.getState();
      const b = s.bundle;
      if (!b) return;
      const [t0, t1] = timeRange(b);
      const modes: Mode[] = ["incident", "drones", "resources"];
      switch (e.key) {
        case " ":
          e.preventDefault();
          if (!s.playing && s.time >= t1 - 60) s.setTime(t0);
          s.set({ playing: !s.playing });
          break;
        case "ArrowRight":
          if ((e.target as HTMLElement)?.getAttribute("role") === "slider") return;
          s.setTime(s.time + (e.shiftKey ? 86400 : 3600));
          break;
        case "ArrowLeft":
          if ((e.target as HTMLElement)?.getAttribute("role") === "slider") return;
          s.setTime(s.time - (e.shiftKey ? 86400 : 3600));
          break;
        case "1":
        case "2":
        case "3":
          s.set({ mode: modes[Number(e.key) - 1], follow: null });
          break;
        case ".":
        case ",": {
          const ps = passesWithFire(b);
          const p = e.key === "." ? ps.find((x) => x.t > s.time + 60) : [...ps].reverse().find((x) => x.t < s.time - 60);
          if (p) s.setTime(p.t);
          break;
        }
        case "r":
        case "R":
          s.set({ follow: null });
          s.flyTo({ bounds: b.meta.bbox, pitch: s.view3d ? 52 : 0, bearing: -12 });
          break;
        case "Escape":
          s.set({ follow: null, cameraOpen: false, panel: null, sheetOpen: false });
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function App() {
  const bundle = useStore((s) => s.bundle);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const toast = useStore((s) => s.toast);
  const theme = useStore((s) => s.theme);
  const lang = useStore((s) => s.lang);
  const t = useT();
  usePlayback();
  useKeyboard();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
  }, [theme, lang]);

  useEffect(() => {
    const url = readUrl();
    useStore.getState().set({
      lang: url.lang ?? (navigator.language.startsWith("pt") ? "pt" : navigator.language.startsWith("es") ? "es" : "en"),
      units: url.units ?? "metric",
      tz: url.tz ?? "local",
      theme: url.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
      mode: url.mode ?? "incident",
    });
    loadIndex()
      .then((idx) => {
        useStore.getState().set({ index: idx });
        const id = url.incident && idx.some((i) => i.id === url.incident) ? url.incident : idx[0]?.id;
        if (id) return selectIncident(id, url).then(() => url.tour && useStore.getState().set({ tour: 0 }));
      })
      .catch((e) => useStore.getState().set({ error: String(e) }));
  }, []);

  // keep the address bar in sync, a few times a second at most
  useEffect(() => {
    let tm: ReturnType<typeof setTimeout> | undefined;
    return useStore.subscribe((s, p) => {
      if (s.time === p.time && s.mode === p.mode && s.incidentId === p.incidentId && s.lang === p.lang) return;
      clearTimeout(tm);
      tm = setTimeout(syncUrl, 400);
    });
  }, []);

  useEffect(() => {
    if (bundle) document.title = `${bundle.meta.name} · Emberline`;
  }, [bundle]);

  return (
    <div className="app">
      <TopBar />
      {bundle && (
        <div className="main">
          <div className="left">
            <MapView />
            <Dock />
          </div>
          <RightPanel />
        </div>
      )}
      {(loading != null || (!bundle && !error)) && (
        <div className="loading" aria-live="polite">
          <div className="box">
            <div style={{ fontWeight: 700, fontSize: 18 }}>Emberline</div>
            <div className="muted">{t("loading")}…</div>
            <div className="pbar">
              <i style={{ width: `${Math.round((loading ?? 0.05) * 100)}%` }} />
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="loading">
          <div className="box">
            <b>Could not load data</b>
            <p className="muted">{error}</p>
          </div>
        </div>
      )}
      <Modals />
      <Tour />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
