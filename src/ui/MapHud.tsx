import { useEffect, useState, type RefObject } from "react";
import type maplibregl from "maplibre-gl";
import { useStore, useQuantTime } from "../store";
import { useT } from "../i18n";
import { useFmt } from "../lib/format";
import { compass } from "../lib/geo";
import { sunPosition } from "../lib/sun";
import { severityClass, weatherAt } from "../data/analytics";
import { Icon } from "./icons";
import { DroneCam } from "./DroneCam";
import { PROGRESSION_STOPS, SEVERITY_LEGEND } from "../map/fireCanvas";

export function MapHud({ mapRef }: { mapRef: RefObject<maplibregl.Map | null> }) {
  const view3d = useStore((s) => s.view3d);
  const hover = useStore((s) => s.hover);
  const layers = useStore((s) => s.layers);
  const compare = useStore((s) => s.compare);
  const b = useStore((s) => s.bundle)!;
  const time = useQuantTime(600);
  const fmt = useFmt();
  const t = useT();
  const [bearing, setBearing] = useState(0);
  const [pitch, setPitch] = useState(0);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const on = () => {
      setBearing(m.getBearing());
      setPitch(m.getPitch());
    };
    m.on("rotate", on);
    m.on("pitch", on);
    on();
    return () => {
      m.off("rotate", on);
      m.off("pitch", on);
    };
  }, [mapRef, b]);

  const w = weatherAt(b, time);
  const sun = sunPosition(time, b.meta.center[0], b.meta.center[1]);
  const isNight = sun.altitude < -0.833;

  return (
    <>
      <div className="hud tl">
        <button
          className="hud-box compass"
          title="Reset north"
          aria-label="Reset north"
          onClick={() => mapRef.current?.easeTo({ bearing: 0, duration: 600 })}
        >
          <svg width="30" height="30" viewBox="0 0 30 30" style={{ transform: `rotate(${-bearing}deg) rotateX(${pitch * 0.6}deg)` }}>
            <path d="M15 3 19 15H11z" fill="var(--accent-2)" />
            <path d="M15 27 19 15H11z" fill="var(--muted)" />
            <text x="15" y="2.5" fontSize="6" textAnchor="middle" fill="var(--text)" fontWeight="700" dy="-0.5">
              N
            </text>
          </svg>
        </button>
        {layers.wind.on && w && w.wdir != null && (
          <div className="hud-box wind" title={`Wind from ${compass(w.wdir)} at ${fmt.speed(w.wspd)} (${b.weather?.station.name})`}>
            <svg width="26" height="26" viewBox="-13 -13 26 26" style={{ transform: `rotate(${(w.wdir + 180 - bearing) % 360}deg)` }}>
              <circle r="12" fill="none" stroke="var(--line-2)" />
              <path d="M0 -10 5 4 0 1 -5 4z" fill="#1c7ed6" />
            </svg>
            <span>
              <b>{fmt.speed(w.wspd)}</b>
              <br />
              {t("w_from")} {compass(w.wdir)}
              {w.gust ? ` · G ${fmt.speed(w.gust)}` : ""}
            </span>
          </div>
        )}
        <div className="hud-box daynight" title={`Sun ${sun.altitude.toFixed(0)}° above horizon`}>
          <Icon name={isNight ? "moon" : "sun"} size={14} />
          {isNight ? "Night" : "Day"} · {fmt.time(time)}
        </div>
        {(layers.progression.on || layers.severity.on) && (
          <div className="hud-box legend">
            {layers.progression.on && (
              <>
                <b>{t("l_progression")}</b>
                <div className="grad" style={{ background: `linear-gradient(90deg, ${PROGRESSION_STOPS.map(([f, r, g, bb]) => `rgb(${r},${g},${bb}) ${f * 100}%`).join(",")})` }} />
                <div style={{ display: "flex", justifyContent: "space-between", width: 180 }} className="muted">
                  <span>{fmt.dayShort(b.meta.t0_epoch)}</span>
                  <span>{fmt.dayShort(Date.parse(b.meta.end) / 1000)}</span>
                </div>
              </>
            )}
            {layers.severity.on && !layers.progression.on && (
              <>
                <b>{t("l_severity")}</b>
                <div className="sw-row">
                  {SEVERITY_LEGEND.map((s) => (
                    <span key={s.label}>
                      <i style={{ background: `rgb(${s.rgb.join(",")})` }} />
                      {s.label}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="hud br">
        <div className="hud-box hud-btns">
          <button className={!view3d ? "on" : ""} onClick={() => useStore.getState().set({ view3d: false })}>
            2D
          </button>
          <button className={view3d ? "on" : ""} onClick={() => useStore.getState().set({ view3d: true })}>
            3D
          </button>
        </div>
        <div className="hud-box hud-btns">
          <button aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
            −
          </button>
          <button aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
            +
          </button>
        </div>
        <div className="hud-box hud-btns">
          <button
            aria-label={t("reset_view")}
            title={t("reset_view")}
            onClick={() => {
              useStore.getState().set({ follow: null });
              useStore.getState().flyTo({ bounds: b.meta.bbox, pitch: view3d ? 52 : 0, bearing: -12 });
            }}
          >
            <Icon name="target" size={15} />
          </button>
          <button
            aria-label="Fullscreen"
            title="Fullscreen"
            onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen();
              else document.documentElement.requestFullscreen?.();
            }}
          >
            <Icon name="max" size={15} />
          </button>
        </div>
      </div>

      <div className="hud bl attrib">
        VIIRS 375 m active fire: NOAA EFIRE (S-NPP, NOAA-20, NOAA-21) via NOAA Open Data · Sentinel-2 L2A: Copernicus / ESA, Element 84 COGs · Weather: NOAA ISD · Terrain: AWS Terrain Tiles · Imagery: Esri
      </div>

      {compare != null && (
        <div className="hud-box compare-bar">
          <b>{t("l_s2pre")}</b>
          <input type="range" min={0} max={1} step={0.01} value={compare} onChange={(e) => useStore.getState().set({ compare: Number(e.target.value) })} aria-label={t("compare")} />
          <b>{t("l_s2post")}</b>
          <button className="icon-btn" onClick={() => useStore.getState().set({ compare: null })} aria-label={t("close")}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {hover && (
        <div className="hover-tip" style={{ left: hover.x, top: hover.y }}>
          <div>
            <span className="k">Lat/Lon</span>
            {hover.lat.toFixed(4)}, {hover.lon.toFixed(4)}
          </div>
          {hover.elev != null && (
            <div>
              <span className="k">{t("elevation")}</span>
              {fmt.alt(hover.elev)}
            </div>
          )}
          <div>
            <span className="k">{t("burned_at")}</span>
            {hover.arrival != null ? `${fmt.dateTime(hover.arrival)}${hover.arrival > useStore.getState().time ? " (later)" : ""}` : t("unburned")}
          </div>
          {hover.severity != null && hover.arrival != null && (
            <div>
              <span className="k">{t("severity")}</span>
              {severityClass(b, hover.severity)} · dNBR {hover.severity.toFixed(2)}
            </div>
          )}
        </div>
      )}
      <DroneCam />
    </>
  );
}
