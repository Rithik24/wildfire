import { useMemo } from "react";
import { useStore, useQuantTime, type LayerId } from "../store";
import { useT, type TKey } from "../i18n";
import { useFmt } from "../lib/format";
import { Chip } from "./common";
import { compactNum } from "./TimeChart";
import { Icon, type IconName } from "./icons";
import type { Prov } from "../data/types";
import { activeHotspots, areaAt, detectionRange, frontAreaAt, lastPass, weatherAt } from "../data/analytics";
import { compass, fmtLatLon } from "../lib/geo";
import { getSims } from "../sim/registry";
import type { DroneState } from "../sim/drones";
import { opsAt, type UnitState } from "../sim/ops";

const LAYERS: { id: LayerId; key: TKey; prov: Prov; sw: string; opacity?: boolean }[] = [
  { id: "terrain", key: "l_terrain", prov: "external", sw: "linear-gradient(135deg,#c9b48f,#7d6a4f)" },
  { id: "imagery", key: "l_imagery", prov: "external", sw: "linear-gradient(135deg,#6b7d4f,#3d4a2c)", opacity: true },
  { id: "s2pre", key: "l_s2pre", prov: "real", sw: "linear-gradient(135deg,#7f9a5a,#4c6b34)", opacity: true },
  { id: "s2post", key: "l_s2post", prov: "real", sw: "linear-gradient(135deg,#6f5a4a,#3a2b22)", opacity: true },
  { id: "burned", key: "l_burned", prov: "derived", sw: "linear-gradient(135deg,#4a3a30,#1d1612)", opacity: true },
  { id: "front", key: "l_front", prov: "derived", sw: "radial-gradient(circle at 40% 40%,#fff3bf,#ff8c1a 45%,#c92a2a)", opacity: true },
  { id: "detections", key: "l_detections", prov: "real", sw: "radial-gradient(circle,#fff 18%,#ffa94d 30%,transparent 34%),#3a2b22", opacity: true },
  { id: "hotspots", key: "l_hotspots", prov: "derived", sw: "radial-gradient(circle,#ffe066 22%,#ff4d1a 26%,transparent 40%),#3a2b22" },
  { id: "perimeters", key: "l_perimeters", prov: "derived", sw: "repeating-linear-gradient(135deg,#ffe066 0 2px,transparent 2px 5px,#f76707 5px 7px,transparent 7px 10px),#3a2b22", opacity: true },
  { id: "progression", key: "l_progression", prov: "derived", sw: "linear-gradient(90deg,#ffed6f,#f03b20,#7a0177,#2d004b)", opacity: true },
  { id: "severity", key: "l_severity", prov: "derived", sw: "linear-gradient(90deg,#ffd666,#fc8d3c,#d7301f,#6e0f28)", opacity: true },
  { id: "smoke", key: "l_smoke", prov: "sim", sw: "radial-gradient(circle at 40% 60%,#dee2e6,#868e96)", opacity: true },
  { id: "wind", key: "l_wind", prov: "real", sw: "linear-gradient(135deg,#d0ebff,#74c0fc)" },
  { id: "ops", key: "l_ops", prov: "sim", sw: "linear-gradient(135deg,#e03131 0 45%,#1c7ed6 55%)" },
  { id: "labels", key: "l_labels", prov: "external", sw: "linear-gradient(135deg,#f8f9fa,#ced4da)" },
];

function LayersCard() {
  const layers = useStore((s) => s.layers);
  const hasS2 = useStore((s) => !!s.bundle?.meta.imagery);
  const hasSeverity = useStore((s) => s.bundle?.meta.method.b_channel === "dnbr");
  const live = useStore((s) => !!s.bundle?.meta.live);
  const t = useT();
  return (
    <div className="card">
      <h3>
        <Icon name="layers" /> {t("layers")}
      </h3>
      {LAYERS.filter((l) => (hasS2 || !l.id.startsWith("s2")) && (hasSeverity || l.id !== "severity")).map((l) => {
        const st = layers[l.id];
        return (
          <div key={l.id} className={`layer ${st.on ? "" : "off"}`}>
            <input type="checkbox" checked={st.on} onChange={(e) => useStore.getState().setLayer(l.id, { on: e.target.checked })} aria-label={t(l.key)} />
            <span className="sw" style={{ background: l.sw }} />
            <span className="ln">
              {live && l.id === "s2post" ? "Sentinel-2 · latest" : t(l.key)} <Chip p={l.prov} />
            </span>
            {l.opacity ? (
              <span className="op">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={st.opacity}
                  disabled={!st.on}
                  onChange={(e) => useStore.getState().setLayer(l.id, { opacity: Number(e.target.value) })}
                  aria-label={`${t(l.key)} opacity`}
                />
                {Math.round(st.opacity * 100)}%
              </span>
            ) : (
              <span />
            )}
          </div>
        );
      })}
    </div>
  );
}

function OverviewCard() {
  const b = useStore((s) => s.bundle)!;
  const fmt = useFmt();
  const t = useT();
  const m = b.meta;
  const r = m.reported;
  const reportedHa = r.final_acres ? r.final_acres * 0.404686 : null;
  const diff = reportedHa ? ((m.stats.area_ha - reportedHa) / reportedHa) * 100 : null;
  return (
    <div className="card">
      <h3>
        {t("overview")}
        <span className="right-x muted mono" style={{ fontSize: 11 }}>
          {m.id}
        </span>
      </h3>
      <dl className="kv">
        <dt>{t("o_incident")}</dt>
        <dd>
          {m.live && <span className="live-tag">LIVE</span>} {m.name}
        </dd>
        {m.live && (
          <>
            <dt>Status</dt>
            <dd>
              Burning: {fmt.num(m.live.active_24h)} fire pixels in the last 24 h · scan {m.live.updated.replace("T", " ")} UTC
            </dd>
          </>
        )}
        <dt>{t("o_location")}</dt>
        <dd>{m.region}</dd>
        <dt>{t("o_window")}</dt>
        <dd>
          {fmt.date(Date.parse(m.t0) / 1000)} – {fmt.date(Date.parse(m.end) / 1000)}
        </dd>
        <dt>{t("o_first")}</dt>
        <dd>
          {fmt.dateTime(Date.parse(m.stats.first_detection) / 1000)} <Chip p="real" />
        </dd>
        <dt>{t("o_burned_derived")}</dt>
        <dd>
          {fmt.area(m.stats.area_ha)} <span className="muted">({fmt.areaSecondary(m.stats.area_ha)})</span> <Chip p="derived" />
        </dd>
        {reportedHa && (
          <>
            <dt>{t("o_burned_reported")}</dt>
            <dd>
              {fmt.area(reportedHa)} <Chip p="reported" />
              {diff != null && <span className="muted">Δ {diff > 0 ? "+" : ""}{diff.toFixed(1)}%</span>}
            </dd>
          </>
        )}
        {r.structures_destroyed != null && (
          <>
            <dt>{t("o_structures")}</dt>
            <dd>
              {fmt.num(r.structures_destroyed)} <Chip p="reported" />
            </dd>
          </>
        )}
        {r.cause && (
          <>
            <dt>{t("o_cause")}</dt>
            <dd>{r.cause}</dd>
          </>
        )}
        {r.contained && (
          <>
            <dt>{t("o_contained")}</dt>
            <dd>
              {fmt.date(Date.parse(r.contained) / 1000 + 43200)} <Chip p="reported" />
            </dd>
          </>
        )}
        <dt>{t("o_detections")}</dt>
        <dd>
          {fmt.num(m.stats.detections)} · {Object.entries(m.stats.satellites).map(([k, v]) => `${k} ${fmt.num(v)}`).join(" · ")}
        </dd>
        <dt>{t("o_passes")}</dt>
        <dd>
          {m.stats.overpasses_with_fire} / {m.stats.overpasses}
        </dd>
        <dt>{t("o_peak_frp")}</dt>
        <dd>
          {fmt.num(m.stats.peak_frp_mw / 1000, 1)} GW <Chip p="real" />
        </dd>
        <dt>{t("o_method")}</dt>
        <dd>
          {m.method.scar === "s2-dnbr"
            ? `Sentinel-2 dNBR ≥ ${m.method.dnbr_min}${m.method.nbr_post_max != null ? `, NBR ≤ ${m.method.nbr_post_max}` : ""} + VIIRS timing`
            : `VIIRS 375 m footprints${m.live ? " (fire still burning: no final scar yet; tends to overestimate)" : ""}`}
        </dd>
      </dl>
    </div>
  );
}

function FireNowCard() {
  const b = useStore((s) => s.bundle)!;
  const time = useQuantTime(900);
  const fmt = useFmt();
  const t = useT();
  const area = areaAt(b, time);
  const front = frontAreaAt(b, time);
  const growth = area - areaAt(b, time - 6 * 3600);
  const [i0, i1] = detectionRange(b, time);
  const lp = lastPass(b, time);
  const day = b.meta.days.find((d) => d.t_end >= time);
  const tiles: { icon: IconName; label: string; value: string; hint?: string; prov: Prov }[] = [
    { icon: "flame", label: t("f_burned"), value: fmt.area(area), hint: fmt.areaSecondary(area), prov: "derived" },
    { icon: "trend", label: t("f_front"), value: fmt.area(front), hint: "last 12 h", prov: "derived" },
    { icon: "gauge", label: t("f_growth"), value: `+${fmt.area(growth)}`, prov: "derived" },
    { icon: "sat", label: t("f_detections"), value: fmt.num(i1 - i0), hint: "375 m pixels", prov: "real" },
    { icon: "radio", label: t("f_frp"), value: lp ? `${fmt.num(lp.frp)} MW` : "—", hint: lp ? `${lp.sat} · ${fmt.time(lp.t)}` : undefined, prov: "real" },
    { icon: "route", label: t("f_spread"), value: day && day.advance_km ? fmt.dist(day.advance_km) : "—", hint: day?.bearing != null ? `toward ${compass(day.bearing)} · ${day.date}` : "per day", prov: "derived" },
  ];
  return (
    <div className="card">
      <h3>
        {t("fire_now")} <span className="sub">{fmt.dateTime(time)}</span>
      </h3>
      <div className="tiles">
        {tiles.map((x) => (
          <div className="tile" key={x.label}>
            <div className="lbl">
              <Icon name={x.icon} size={13} /> {x.label}
            </div>
            <div className="val">{x.value}</div>
            <div className="hint">{x.hint ?? <Chip p={x.prov} />}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeatherCard() {
  const b = useStore((s) => s.bundle)!;
  const time = useQuantTime(1800);
  const fmt = useFmt();
  const t = useT();
  const w = weatherAt(b, time);
  const st = b.weather?.station;
  return (
    <div className="card">
      <h3>
        {t("conditions")} <span className="sub">{st ? `${st.name.split(",")[0].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}` : ""}</span>
        <span className="right-x">
          {b.weather?.prov === "external" ? (
            <Chip p="external" title="Open-Meteo hourly model data at the fire (station archives lag for live fires)" />
          ) : (
            <Chip p="real" title="NOAA Integrated Surface Database: hourly airport observations" />
          )}
        </span>
      </h3>
      {w ? (
        <div className="tiles">
          <div className="tile">
            <div className="lbl">
              <Icon name="wind" size={13} /> {t("w_wind")}
            </div>
            <div className="val">{fmt.speed(w.wspd)}</div>
            <div className="hint">
              {t("w_from")} {compass(w.wdir)} {w.wdir != null ? `(${Math.round(w.wdir)}°)` : ""}
            </div>
          </div>
          <div className="tile">
            <div className="lbl">
              <Icon name="wind" size={13} /> {t("w_gust")}
            </div>
            <div className="val">{fmt.speed(w.gust)}</div>
          </div>
          <div className="tile">
            <div className="lbl">
              <Icon name="thermo" size={13} /> {t("w_temp")}
            </div>
            <div className="val">{fmt.temp(w.temp)}</div>
          </div>
          <div className="tile">
            <div className="lbl">
              <Icon name="drop" size={13} /> {t("w_rh")}
            </div>
            <div className="val" style={{ color: w.rh != null && w.rh < 15 ? "var(--accent-2)" : undefined }}>
              {w.rh != null ? `${Math.round(w.rh)}%` : "—"}
            </div>
            <div className="hint">{w.rh != null && w.rh < 15 ? "critically dry" : ""}</div>
          </div>
          <div className="tile" style={{ gridColumn: "span 2" }}>
            <div className="lbl">
              <Icon name="pin" size={13} /> {t("w_station")}
            </div>
            <div className="hint" style={{ marginTop: 3 }}>
              {st?.id} · {st ? `${st.lat.toFixed(2)}, ${st.lon.toFixed(2)}` : ""} · {fmt.time(w.t)}
            </div>
          </div>
        </div>
      ) : (
        <p className="note">{t("w_none")}</p>
      )}
    </div>
  );
}

function SourcesCard() {
  const b = useStore((s) => s.bundle)!;
  const src = b.meta.reported.sources ?? [];
  if (!src.length) return null;
  return (
    <div className="card">
      <h3>
        <Icon name="book" /> Reported sources <Chip p="reported" />
      </h3>
      <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.6, fontSize: 12.3 }}>
        {src.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DSTATUS: Record<string, TKey> = { standby: "status", transit: "transit", on_station: "on_station", patrol: "patrol", swap: "swap" };

function DronesPanel() {
  const b = useStore((s) => s.bundle)!;
  const time = useStore((s) => Math.floor(s.time / 60) * 60);
  const sel = useStore((s) => s.selectedDrone);
  const cam = useStore((s) => s.cameraOpen);
  const follow = useStore((s) => s.follow);
  const fmt = useFmt();
  const t = useT();
  const { drones } = getSims(b);
  const all = drones.all(time);
  const up = all.filter((d) => d.status !== "standby").length;
  const d = all.find((x) => x.spec.id === sel) ?? null;
  const hs = useMemo(() => activeHotspots(b, time), [b, time]);
  const target = d?.target ? hs.find((h) => h.id === d.target) : null;
  return (
    <>
      <div className="card">
        <h3>
          {t("fleet")}{" "}
          <span className="sub">
            {up} / {all.length} {t("airborne")}
          </span>
          <span className="right-x">
            <Chip p="sim" />
          </span>
        </h3>
        <div className="list">
          {all.map((x) => (
            <DroneRow key={x.spec.id} d={x} sel={x.spec.id === sel} />
          ))}
        </div>
      </div>
      {d && (
        <div className="card">
          <h3>
            {d.spec.id} <span className="sub">{d.spec.name}</span>
            <span className="right-x">
              <Chip p="sim" />
            </span>
          </h3>
          <div className="tiles" style={{ marginBottom: 12 }}>
            <Tile label={t("altitude")} value={fmt.alt(d.altAgl)} hint="AGL" />
            <Tile label={t("ground_speed")} value={fmt.speed(d.speedKmh)} />
            <Tile label={t("heading")} value={`${Math.round(d.heading)}°`} hint={compass(d.heading)} />
            <Tile label={t("battery")} value={`${Math.round(d.battery)}%`} hint={d.battery < 30 ? "swap soon" : undefined} />
            <Tile label={t("link")} value={`${d.linkDbm}`} hint="dBm" />
            <Tile label={t("flight_time")} value={`${Math.floor(d.flightMin / 60)}:${String(Math.floor(d.flightMin % 60)).padStart(2, "0")}`} hint="since swap" />
          </div>
          <dl className="kv">
            <dt>{t("aircraft")}</dt>
            <dd>{d.spec.model}</dd>
            <dt>{t("mission")}</dt>
            <dd>{d.mission}</dd>
            <dt>{t("status")}</dt>
            <dd>{t(DSTATUS[d.status] ?? "status")}</dd>
            <dt>{t("target")}</dt>
            <dd>
              {target ? (
                <>
                  <b>{target.id}</b> · {Math.round(target.frp)} MW · {t(target.status as TKey)} <Chip p="real" />
                </>
              ) : (
                t("no_tasks")
              )}
            </dd>
            <dt>{t("sensor")}</dt>
            <dd>{d.spec.sensor}</dd>
            <dt>{t("position")}</dt>
            <dd className="mono">{fmtLatLon(d.pos[0], d.pos[1])}</dd>
          </dl>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className={`btn ${cam ? "primary" : ""}`} onClick={() => useStore.getState().set({ cameraOpen: !cam })}>
              <Icon name="camera" size={14} /> {cam ? t("hide_camera") : t("camera_view")}
            </button>
            <button className={`btn ${follow === d.spec.id ? "on" : "dark"}`} onClick={() => useStore.getState().set({ follow: follow === d.spec.id ? null : d.spec.id })}>
              <Icon name="crosshair" size={14} /> {follow === d.spec.id ? t("following") : t("follow")}
            </button>
          </div>
          <p className="note">{t("sim_note")}</p>
        </div>
      )}
      <HotspotsCard />
    </>
  );
}

function HotspotsCard() {
  const b = useStore((s) => s.bundle)!;
  const time = useQuantTime(600);
  const sel = useStore((s) => s.selectedHotspot);
  const fmt = useFmt();
  const t = useT();
  const hs = activeHotspots(b, time).slice(0, 10);
  return (
    <div className="card">
      <h3>
        {t("l_hotspots")} <span className="sub">{hs.length} active</span>
        <span className="right-x">
          <Chip p="derived" title="VIIRS fire pixels clustered per overpass and linked between overpasses" />
        </span>
      </h3>
      <div className="list">
        {hs.length === 0 && <p className="note">No hot spot seen by VIIRS in the last 30 h.</p>}
        {hs.map((h) => (
          <button
            key={h.id}
            className={`row ${sel === h.id ? "sel" : ""}`}
            onClick={() => {
              useStore.getState().set({ selectedHotspot: h.id });
              useStore.getState().flyTo({ center: h.pos, zoom: 12.5, duration: 1200 });
            }}
          >
            <span className="ico" style={{ color: h.status === "cooling" ? "#f08c00" : "#e03131" }}>
              <Icon name="flame" size={15} />
            </span>
            <span>
              <span className="t1">{h.id}</span>
              <span className="t2">
                {t(h.status as TKey)} · {h.pixels} px · BT₄ {Math.round(h.bt4)} K
              </span>
            </span>
            <span className="r">
              <b style={{ color: "var(--text)" }}>{fmt.num(h.frp)} MW</b>
              <span>{fmt.dateTime(h.lastSeen)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DroneRow({ d, sel }: { d: DroneState; sel: boolean }) {
  const t = useT();
  const fmt = useFmt();
  return (
    <button className={`row ${sel ? "sel" : ""}`} onClick={() => useStore.getState().set({ selectedDrone: d.spec.id, cameraOpen: true })}>
      <span className="ico" style={{ color: sel ? undefined : d.spec.color }}>
        <Icon name="drone" size={16} />
      </span>
      <span>
        <span className="t1">
          {d.spec.id} <span>{d.spec.name}</span>
        </span>
        <span className="t2">
          <span className="dot" style={{ background: d.status === "standby" ? "var(--muted)" : d.status === "transit" ? "#f59f00" : "#2f9e44" }} />
          {t(DSTATUS[d.status] ?? "status")}
          {d.target ? ` · ${d.target}` : ""}
        </span>
      </span>
      <span className="r">
        <span>
          <b style={{ color: d.battery < 30 ? "var(--accent-2)" : "var(--chip-sim)" }}>{Math.round(d.battery)}%</b>
        </span>
        <span>{d.status === "standby" ? "—" : `${fmt.alt(d.altAgl)} AGL`}</span>
      </span>
    </button>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="tile">
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

const GROUP_ICON: Record<string, IconName> = { air: "plane", engines: "truck", crews: "crew" };

function unitIcon(u: UnitState): IconName {
  if (u.spec.kind === "heli") return "heli";
  if (u.spec.kind === "dozer") return "dozer";
  return GROUP_ICON[u.spec.group];
}

function ResourcesPanel() {
  const b = useStore((s) => s.bundle)!;
  const time = useStore((s) => Math.floor(s.time / 120) * 120);
  const sel = useStore((s) => s.selectedUnit);
  const follow = useStore((s) => s.follow);
  const fmt = useFmt();
  const t = useT();
  const { ops } = getSims(b);
  const f = opsAt(ops, b, time);
  const u = f.units.find((x) => x.spec.id === sel) ?? null;
  const imperial = useStore((s) => s.units) === "imperial";
  const groups: { id: "air" | "engines" | "crews"; key: TKey }[] = [
    { id: "air", key: "air" },
    { id: "engines", key: "engines" },
    { id: "crews", key: "crews" },
  ];
  const chains = (f.lineKm * 1000) / 20.1168;
  return (
    <>
      <div className="card">
        <h3>
          {t("resources")} <span className="sub">{f.units.length} {t("units")}</span>
          <span className="right-x">
            <Chip p="sim" />
          </span>
        </h3>
        <div className="kpis">
          <div className="tile">
            <div className="val">
              {f.airUp}/{f.airTotal}
            </div>
            <div className="hint">{t("aircraft_up")}</div>
          </div>
          <div className="tile">
            <div className="val">{compactNum(imperial ? f.droppedGal : f.droppedGal * 3.785)}</div>
            <div className="hint">
              {fmt.volumeUnit} {t("dropped")}
            </div>
          </div>
          <div className="tile">
            <div className="val">{imperial ? fmt.num(chains) : fmt.num(f.lineKm, 1)}</div>
            <div className="hint">{imperial ? "chains" : "km"} {t("line")}</div>
          </div>
          <div className="tile">
            <div className="val">{fmt.num(f.personnel)}</div>
            <div className="hint">{t("personnel")}</div>
          </div>
        </div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span className="muted">Containment</span>
          <div className="bar" style={{ flex: 1, height: 6 }}>
            <i style={{ width: `${f.containment}%`, background: "var(--text)" }} />
          </div>
          <b>{Math.round(f.containment)}%</b>
          <Chip p={ops.containmentAnchored() ? "derived" : "sim"} title={ops.containmentAnchored() ? "Interpolated between reported containment values" : "Simulated from the growth slowing down"} />
        </div>
      </div>
      <div className="card" style={{ padding: "6px 6px 8px" }}>
        {groups.map((g) => {
          const list = f.units.filter((x) => x.spec.group === g.id);
          return (
            <div key={g.id}>
              <div className="group-h">
                {t(g.key)} ({list.length})
              </div>
              {list.map((x) => (
                <button key={x.spec.id} className={`row ${sel === x.spec.id ? "sel" : ""}`} onClick={() => useStore.getState().set({ selectedUnit: x.spec.id })}>
                  <span className="ico">
                    <Icon name={unitIcon(x)} size={15} />
                  </span>
                  <span>
                    <span className="t1">
                      {x.spec.id} <span>{x.spec.name}</span>
                    </span>
                    <span className="t2">
                      <span className="dot" style={{ background: statusColor(x.status) }} />
                      {x.status}
                    </span>
                  </span>
                  <span className="r">
                    {x.spec.capacityGal ? fmt.volume(x.spec.capacityGal) : x.spec.crew > 2 ? `${x.spec.crew} pers` : ""}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {u && (
        <div className="card">
          <h3>
            {u.spec.id} <span className="sub">{u.spec.name}</span>
            <span className="right-x">
              <Chip p="sim" />
            </span>
          </h3>
          <dl className="kv">
            <dt>{t("status")}</dt>
            <dd>{u.status}</dd>
            {u.spec.capacityGal > 0 && (
              <>
                <dt>Capacity</dt>
                <dd>
                  {fmt.volume(u.spec.capacityGal)} {u.spec.agent ?? ""}
                </dd>
              </>
            )}
            <dt>Crew</dt>
            <dd>{u.spec.crew}</dd>
            {u.airborne && (
              <>
                <dt>{t("altitude")}</dt>
                <dd>{fmt.alt(u.altAgl)} AGL</dd>
                <dt>{t("heading")}</dt>
                <dd>
                  {Math.round(u.heading)}° {compass(u.heading)}
                </dd>
              </>
            )}
            <dt>{t("position")}</dt>
            <dd className="mono">{fmtLatLon(u.pos[0], u.pos[1])}</dd>
          </dl>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {u.spec.group === "air" ? (
              <button
                className={`btn ${follow === u.spec.id ? "on" : "dark"}`}
                onClick={() => {
                  const st = useStore.getState();
                  st.set({ follow: follow === u.spec.id ? null : u.spec.id });
                  if (follow !== u.spec.id) st.flyTo({ center: u.pos, zoom: 12.5, pitch: 70, bearing: u.heading, duration: 1200 });
                }}
              >
                <Icon name="plane" size={14} /> {t("chase")}
              </button>
            ) : (
              <button
                className={`btn ${follow === u.spec.id ? "on" : "dark"}`}
                onClick={() => {
                  const st = useStore.getState();
                  st.set({ follow: follow === u.spec.id ? null : u.spec.id });
                  if (follow !== u.spec.id) st.flyTo({ center: u.pos, zoom: 14.5, pitch: 74, bearing: u.heading, duration: 1200 });
                }}
              >
                <Icon name="truck" size={14} /> {t("ride_along")}
              </button>
            )}
            <button
              className="btn"
              onClick={() => {
                useStore.getState().set({ follow: null });
                useStore.getState().flyTo({ bounds: b.meta.bbox, pitch: 50, bearing: -12 });
              }}
            >
              <Icon name="globe" size={14} /> {t("overview_cam")}
            </button>
          </div>
        </div>
      )}
      <div className="card">
        <h3>{t("operations")}</h3>
        <p className="note" style={{ marginTop: 0 }}>
          {t("ops_note")}
        </p>
      </div>
    </>
  );
}

function statusColor(s: string): string {
  if (s === "dropping") return "#e03131";
  if (s === "inbound" || s === "returning") return "#f59f00";
  if (s === "reloading" || s === "staged" || s === "grounded") return "var(--muted)";
  return "#2f9e44";
}

export function RightPanel() {
  const mode = useStore((s) => s.mode);
  const open = useStore((s) => s.sheetOpen);
  return (
    <aside className={`right ${open ? "open" : ""}`} aria-label="Details">
      {mode === "incident" && (
        <>
          <LayersCard />
          <FireNowCard />
          <WeatherCard />
          <OverviewCard />
          <SourcesCard />
        </>
      )}
      {mode === "drones" && <DronesPanel />}
      {mode === "resources" && <ResourcesPanel />}
    </aside>
  );
}

