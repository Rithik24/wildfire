import { useMemo, useState } from "react";
import { useStore, timeRange } from "../store";
import { useT } from "../i18n";
import { useFmt } from "../lib/format";
import { Timeline } from "./Timeline";
import { TimeChart, type Series } from "./TimeChart";
import { Icon } from "./icons";
import { Chip } from "./common";
import { eventColor, eventsForMode, type UiEvent } from "./events";
import { activeHotspots, frontGeometry, rateSeries } from "../data/analytics";
import { nightIntervals } from "../lib/sun";
import { getSims } from "../sim/registry";
import { opsAt } from "../sim/ops";
import { DRONES } from "../sim/drones";
import type { IncidentBundle } from "../data/types";

const seriesCache = new Map<string, Series>();

function sampled(b: IncidentBundle, key: string, step: number, fn: (t: number) => number): Series {
  const k = `${b.meta.id}|${key}`;
  const hit = seriesCache.get(k);
  if (hit) return hit;
  const [t0, t1] = timeRange(b);
  const t: number[] = [];
  const v: number[] = [];
  for (let x = t0; x <= t1; x += step) {
    t.push(x);
    v.push(fn(x));
  }
  const s = { t, v };
  seriesCache.set(k, s);
  return s;
}

/** A 12-hour window around the cursor, sampled every 5 minutes. */
function rolling(center: number, fn: (t: number) => number): Series {
  const t: number[] = [];
  const v: number[] = [];
  for (let x = center - 9 * 3600; x <= center + 3 * 3600; x += 300) {
    t.push(x);
    v.push(fn(x));
  }
  return { t, v };
}

function Charts() {
  const b = useStore((s) => s.bundle)!;
  const mode = useStore((s) => s.mode);
  const drone = useStore((s) => s.selectedDrone) ?? DRONES[1].id;
  const units = useStore((s) => s.units);
  const t = useT();
  const fmt = useFmt();
  const domain = timeRange(b);
  const nights = useMemo(() => nightIntervals(domain[0], domain[1], b.meta.center[0], b.meta.center[1]), [b]);
  const qt = useStore((s) => Math.floor(s.time / 900) * 900);
  const imperial = units === "imperial";
  const conv = (ha: number) => (imperial ? ha / 0.404686 : ha);

  const incident = useMemo(() => {
    const area: Series = { t: b.meta.hourly.t, v: b.meta.hourly.area_ha.map(conv) };
    const r = rateSeries(b);
    const rate: Series = { t: r.map((x) => x.t), v: r.map((x) => conv(x.v)) };
    const fp = b.meta.passes.filter((p) => p.n > 0);
    const frp: Series = { t: fp.map((p) => p.t), v: fp.map((p) => p.frp) };
    const markers = (b.meta.reported.facts ?? [])
      .filter((f) => f.acres)
      .map((f) => ({ t: Date.parse(f.t) / 1000, v: imperial ? f.acres! : f.acres! * 0.404686, label: `${f.text} — ${f.source}` }));
    return { area, rate, frp, markers };
  }, [b, imperial]);

  if (mode === "incident") {
    return (
      <div className="charts">
        <TimeChart title={t("c_area")} unit={fmt.areaUnit} prov="derived" series={incident.area} domain={domain} nights={nights} markers={incident.markers} csvName={`${b.meta.id}-burned-area.csv`} dimFuture fmt={(v) => `${fmt.num(v)} ${fmt.areaUnit}`} />
        <TimeChart title={t("c_rate")} unit={`${fmt.areaUnit}/h`} prov="derived" kind="line" series={incident.rate} domain={domain} nights={nights} csvName={`${b.meta.id}-expansion-rate.csv`} dimFuture fmt={(v) => `${fmt.num(v)} ${fmt.areaUnit}/h`} />
        <TimeChart title={t("c_frp")} unit="MW · VIIRS" prov="real" kind="bars" color="#e03131" series={incident.frp} domain={domain} nights={nights} csvName={`${b.meta.id}-frp-per-pass.csv`} dimFuture fmt={(v) => `${fmt.num(v)} MW`} />
      </div>
    );
  }
  if (mode === "drones") {
    const { drones } = getSims(b);
    const di = Math.max(0, DRONES.findIndex((d) => d.id === drone));
    const hot = sampled(b, "hot", 1800, (x) => activeHotspots(b, x).filter((h) => h.status !== "cooling").length);
    const maxFrp = sampled(b, "hotfrp", 1800, (x) => activeHotspots(b, x)[0]?.frp ?? 0);
    const batt = rolling(qt, (x) => {
      const s = drones.state(x, di);
      return s.status === "standby" ? 100 : s.battery;
    });
    return (
      <div className="charts">
        <TimeChart title={t("c_hotspots")} unit="count" prov="derived" kind="step" series={hot} domain={domain} nights={nights} csvName={`${b.meta.id}-active-hotspots.csv`} dimFuture />
        <TimeChart title="Strongest hot spot" unit="MW" prov="real" kind="line" color="#e03131" series={maxFrp} domain={domain} nights={nights} csvName={`${b.meta.id}-strongest-hotspot.csv`} dimFuture fmt={(v) => `${fmt.num(v)} MW`} />
        <TimeChart title={`${t("c_battery")} · ${DRONES[di].id}`} unit="% · 12 h" prov="sim" kind="line" color="#7048e8" series={batt} domain={[qt - 9 * 3600, qt + 3 * 3600]} nights={nights} csvName={`${b.meta.id}-${DRONES[di].id}-battery.csv`} dimFuture fmt={(v) => `${fmt.num(v)}%`} />
      </div>
    );
  }
  const { ops } = getSims(b);
  const dropped = sampled(b, "dropped", 1800, (x) => ops.droppedGal(x) * (imperial ? 1 : 3.785));
  const line = sampled(b, "line", 3600, (x) => opsAt(ops, b, x).lineKm * (imperial ? 0.621 : 1));
  const pers = sampled(b, "pers", 3600, (x) => ops.personnel(x));
  return (
    <div className="charts">
      <TimeChart title={t("c_dropped")} unit={fmt.volumeUnit} prov="sim" kind="step" color="#e03131" series={dropped} domain={domain} nights={nights} csvName={`${b.meta.id}-dropped.csv`} dimFuture fmt={(v) => `${fmt.num(v)} ${fmt.volumeUnit}`} />
      <TimeChart title={t("c_line")} unit={imperial ? "mi" : "km"} prov="sim" kind="area" color="#5c4630" series={line} domain={domain} nights={nights} csvName={`${b.meta.id}-line.csv`} dimFuture fmt={(v) => `${fmt.num(v, 1)} ${imperial ? "mi" : "km"}`} />
      <TimeChart title={t("c_personnel")} unit="count" prov="sim" kind="area" color="#2f9e44" series={pers} domain={domain} nights={nights} csvName={`${b.meta.id}-personnel.csv`} dimFuture />
    </div>
  );
}

function EventsList() {
  const b = useStore((s) => s.bundle)!;
  const mode = useStore((s) => s.mode);
  const lang = useStore((s) => s.lang);
  const sel = useStore((s) => s.selectedEvent);
  const time = useStore((s) => Math.floor(s.time / 1800) * 1800);
  const t = useT();
  const fmt = useFmt();
  const [q, setQ] = useState("");
  const events = useMemo(() => eventsForMode(b, mode, lang), [b, mode, lang]);
  const list = q ? events.filter((e) => (e.title + " " + e.detail).toLowerCase().includes(q.toLowerCase())) : events;
  const title = mode === "incident" ? t("key_events") : mode === "drones" ? t("hotspot_alerts") : t("air_ops_log");
  const past = events.filter((e) => e.t <= time).length;

  const go = (e: UiEvent) => {
    const st = useStore.getState();
    st.setTime(e.t + 1);
    st.set({ selectedEvent: e.t, playing: false });
    const at = e.at ?? frontGeometry(b, e.t + 1).head ?? undefined;
    if (at) st.flyTo({ center: at, zoom: Math.max(11, Math.min(12.5, 13 - Math.log2(Math.max(1, b.meta.stats.area_ha / 2000)) / 2)), duration: 1400 });
  };

  return (
    <div className="events">
      <div className="events-h">
        {title}
        <span className="badge" title="events so far">{past}</span>
        {mode === "resources" && <Chip p="sim" />}
        <label className="find">
          <Icon name="search" size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("find")} aria-label={t("find")} />
        </label>
      </div>
      <div className="events-list">
        {list.map((e, i) => (
          <button key={i} className={`ev ${sel === e.t ? "sel" : ""} ${e.t > time ? "future" : ""}`} onClick={() => go(e)}>
            <span className="dot" style={{ background: eventColor(e.kind), width: e.major ? 10 : 7, height: e.major ? 10 : 7, marginTop: 4 }} />
            <span className="eti">
              {e.title}
              <small title={e.detail}>
                {e.prov === "reported" && <Chip p="reported" />} {mode === "resources" ? e.detail.replace(/^([\d,]+) gal/, (_m, g) => fmt.volume(Number(g.replace(/,/g, "")))) : e.detail}
              </small>
            </span>
            <span className="etime">{fmt.dateTime(e.t)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Dock() {
  return (
    <div className="dock">
      <div className="dock-main">
        <Timeline />
        <Charts />
      </div>
      <EventsList />
    </div>
  );
}
