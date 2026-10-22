import { useShallow } from "zustand/react/shallow";
import { useStore, type Mode } from "../store";
import { useT, type Lang } from "../i18n";
import { useFmt } from "../lib/format";
import { Dropdown } from "./common";
import { Icon } from "./icons";
import { shareUrl } from "../url";

export function TopBar() {
  const b = useStore((s) => s.bundle);
  const mode = useStore((s) => s.mode);
  const lang = useStore((s) => s.lang);
  const liveCount = useStore((s) => s.index.filter((i) => i.live).length);
  const st = useStore(
    useShallow((s) => ({ view3d: s.view3d, exaggeration: s.exaggeration, units: s.units, tz: s.tz, theme: s.theme, compare: s.compare, layers: s.layers, sheetOpen: s.sheetOpen })),
  );
  const t = useT();
  const fmt = useFmt();
  const set = useStore.getState().set;
  if (!b) return <header className="topbar" />;
  const t0 = Date.parse(b.meta.t0) / 1000;
  const t1 = Date.parse(b.meta.end) / 1000;
  const days = Math.round((t1 - t0) / 86400);

  const modes: { id: Mode; icon: "flame" | "drone" | "layers"; label: string; badge?: number }[] = [
    { id: "incident", icon: "flame", label: t("incident") },
    { id: "drones", icon: "drone", label: t("drones"), badge: 6 },
    { id: "resources", icon: "layers", label: t("resources"), badge: b.meta.fleet === "br" ? 13 : b.meta.fleet === "intl" ? 12 : 14 },
  ];

  return (
    <header className="topbar">
      <div className="brand">
        <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
          <defs>
            <linearGradient id="lg" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#d9480f" />
              <stop offset="1" stopColor="#ffb347" />
            </linearGradient>
          </defs>
          <path d="M3 26 L12 10 L17 18 L21 13 L29 26 Z" fill="url(#lg)" />
          <path d="M3 26 L12 10 L15 15 L10 26 Z" fill="#9c2a07" opacity=".55" />
        </svg>
        <span className="name">Emberline</span>
        <span className="tag">{t("app_tag")}</span>
      </div>
      <span className="tb-sep" />
      <button className="tb-incident" onClick={() => set({ panel: "incidents", pickerTab: b.meta.live ? "live" : "archive" })} title={t("incidents")}>
        {b.meta.live && <span className="live-tag">LIVE</span>}
        <Icon name="flame" size={14} className="mobile-only" />
        <span className="inc-name">{b.meta.name}</span> <Icon name="chev" size={14} />
      </button>
      <span className="tb-meta">
        <span className="hide-md">{b.meta.region}</span>
        <span className="hide-md">·</span>
        <Icon name="calendar" size={14} /> {fmt.date(t0)} · {days} d
      </span>
      {liveCount > 0 && (
        <button className="tb-live" onClick={() => set({ panel: "incidents", pickerTab: "live" })} title="Fires burning now, found by scanning every VIIRS fire pixel on Earth">
          <span className="live-dot" />
          <span className="lbl">{liveCount} burning now</span>
          <span className="sm">{liveCount}</span>
        </button>
      )}
      <nav className="modes" aria-label="Mode">
        {modes.map((m) => (
          <button key={m.id} className={mode === m.id ? "on" : ""} onClick={() => set({ mode: m.id, follow: null, selectedDrone: m.id === "drones" ? useStore.getState().selectedDrone ?? "UAV-02" : useStore.getState().selectedDrone })} aria-pressed={mode === m.id}>
            <Icon name={m.icon} size={14} />
            <span className="lbl">{m.label}</span>
            {m.badge != null && <span className="badge">{m.badge}</span>}
          </button>
        ))}
      </nav>
      <span className="tb-sep" />
      <Dropdown
        button={
          <>
            <Icon name="eye" size={15} />
            <span className="lbl">{t("view")}</span>
            <Icon name="chev" size={12} />
          </>
        }
      >
        {(close) => (
          <>
            <div className="mh">Map</div>
            <button className={`mi ${!st.view3d ? "on" : ""}`} onClick={() => (set({ view3d: false }), close())}>
              2D map
            </button>
            <button className={`mi ${st.view3d ? "on" : ""}`} onClick={() => (set({ view3d: true }), close())}>
              3D terrain
            </button>
            <div className="mh">{t("exaggeration")}</div>
            {[1, 1.6, 2.5].map((x) => (
              <button key={x} className={`mi ${st.exaggeration === x ? "on" : ""}`} onClick={() => (set({ exaggeration: x }), close())}>
                ×{x}
              </button>
            ))}
            <hr />
            <div className="mh">Units</div>
            <button className={`mi ${st.units === "metric" ? "on" : ""}`} onClick={() => set({ units: "metric" })}>
              {t("units_metric")} (ha, km/h, °C)
            </button>
            <button className={`mi ${st.units === "imperial" ? "on" : ""}`} onClick={() => set({ units: "imperial" })}>
              {t("units_imperial")} (acres, mph, °F)
            </button>
            <div className="mh">{t("time_zone")}</div>
            <button className={`mi ${st.tz === "local" ? "on" : ""}`} onClick={() => set({ tz: "local" })}>
              {t("local_time")} ({b.meta.timezone})
            </button>
            <button className={`mi ${st.tz === "utc" ? "on" : ""}`} onClick={() => set({ tz: "utc" })}>
              UTC
            </button>
            <div className="mh">Language</div>
            {(["en", "pt", "es"] as Lang[]).map((l) => (
              <button key={l} className={`mi ${lang === l ? "on" : ""}`} onClick={() => set({ lang: l })}>
                {l === "en" ? "English" : l === "pt" ? "Português" : "Español"}
              </button>
            ))}
            <div className="mh">{t("theme")}</div>
            <button className={`mi ${st.theme === "light" ? "on" : ""}`} onClick={() => set({ theme: "light" })}>
              <Icon name="sun" size={14} /> {t("light")}
            </button>
            <button className={`mi ${st.theme === "dark" ? "on" : ""}`} onClick={() => set({ theme: "dark" })}>
              <Icon name="moon" size={14} /> {t("dark")}
            </button>
            <hr />
            <button
              className="mi"
              onClick={() => {
                set({ follow: null });
                useStore.getState().flyTo({ bounds: b.meta.bbox, pitch: st.view3d ? 52 : 0, bearing: -12 });
                close();
              }}
            >
              <Icon name="target" size={14} /> {t("reset_view")} <span className="k">R</span>
            </button>
          </>
        )}
      </Dropdown>
      <Dropdown
        button={
          <>
            <Icon name="chart" size={15} />
            <span className="lbl">{t("analysis")}</span>
            <Icon name="chev" size={12} />
          </>
        }
      >
        {(close) => (
          <>
            {b.meta.imagery && (
              <button className={`mi ${st.compare != null ? "on" : ""}`} onClick={() => (set({ compare: st.compare != null ? null : 0.5 }), close())}>
                <Icon name="compare" size={14} /> {t("compare")} (Sentinel-2)
              </button>
            )}
            <button className={`mi ${st.layers.progression.on ? "on" : ""}`} onClick={() => (useStore.getState().setLayer("progression", { on: !st.layers.progression.on }), close())}>
              <Icon name="calendar" size={14} /> {t("l_progression")}
            </button>
            <button className={`mi ${st.layers.severity.on ? "on" : ""}`} onClick={() => (useStore.getState().setLayer("severity", { on: !st.layers.severity.on }), close())}>
              <Icon name="flame" size={14} /> {t("l_severity")}
            </button>
            <button className={`mi ${st.layers.perimeters.on ? "on" : ""}`} onClick={() => (useStore.getState().setLayer("perimeters", { on: !st.layers.perimeters.on }), close())}>
              <Icon name="route" size={14} /> {t("l_perimeters")}
            </button>
            <hr />
            <button className="mi" onClick={() => (set({ panel: "live" }), close())}>
              <Icon name="radio" size={14} /> {t("live")}…
            </button>
            <button className="mi" onClick={() => (set({ panel: "about" }), close())}>
              <Icon name="book" size={14} /> {t("methods")}
            </button>
          </>
        )}
      </Dropdown>
      <button
        className="tb-btn"
        onClick={() => {
          const url = shareUrl();
          navigator.clipboard?.writeText(url).then(
            () => useStore.getState().showToast(t("link_copied")),
            () => useStore.getState().showToast(url),
          );
        }}
      >
        <Icon name="share" size={15} />
        <span className="lbl">{t("share")}</span>
      </button>
      <div className="tb-right">
        <select
          className="speed hide-sm"
          aria-label="Language"
          value={lang}
          onChange={(e) => set({ lang: e.target.value as Lang })}
          style={{ marginLeft: 0 }}
        >
          <option value="en">EN</option>
          <option value="pt">PT</option>
          <option value="es">ES</option>
        </select>
        <button className="btn primary sm" onClick={() => set({ tour: 0, playing: false })}>
          <Icon name="play" size={11} /> <span className="lbl">{t("tour")}</span>
        </button>
        <button className="icon-btn hide-sm" onClick={() => set({ panel: "about" })} aria-label={t("about")} title={t("about")}>
          <Icon name="info" size={17} />
        </button>
        <button className="icon-btn mobile-only" onClick={() => set({ sheetOpen: !st.sheetOpen })} aria-label="Panel">
          <Icon name="menu" size={17} />
        </button>
      </div>
    </header>
  );
}
