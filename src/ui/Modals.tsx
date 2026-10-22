import { useEffect, useState } from "react";
import { useStore } from "../store";
import { locale, useT, type Lang } from "../i18n";
import { useFmt } from "../lib/format";
import { Icon } from "./icons";
import { Chip } from "./common";
import { selectIncident } from "../app-actions";
import { WorldMap } from "./WorldMap";

function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={wide ? { width: "min(1000px, 100%)" } : undefined}>
        <button className="icon-btn x" onClick={onClose} aria-label="Close">
          <Icon name="x" size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}

export function Modals() {
  const panel = useStore((s) => s.panel);
  const close = () => useStore.getState().set({ panel: null });
  if (panel === "incidents") return <IncidentsModal onClose={close} />;
  if (panel === "about") return <AboutModal onClose={close} />;
  if (panel === "live") return <LiveModal onClose={close} />;
  return null;
}

function IncidentsModal({ onClose }: { onClose: () => void }) {
  const index = useStore((s) => s.index);
  const lang = useStore((s) => s.lang);
  const cur = useStore((s) => s.incidentId);
  const tab = useStore((s) => s.pickerTab);
  const worldPath = useStore((s) => s.worldPath);
  const liveUpdated = useStore((s) => s.liveUpdated);
  const fmt = useFmt();
  const t = useT();
  const [q, setQ] = useState("");
  const live = index.filter((i) => i.live);
  const archive = index.filter((i) => !i.live);
  const list = (tab === "live" ? live : archive).filter((i) => !q || `${i.name} ${i.region} ${i.country}`.toLowerCase().includes(q.toLowerCase()));
  const pick = (id: string) => {
    onClose();
    if (id !== cur) selectIncident(id);
  };
  return (
    <Modal onClose={onClose} wide>
      <h2>{t("incidents")}</h2>
      <p className="muted" style={{ margin: "0 0 10px" }}>
        Every fire is rebuilt from open satellite archives: VIIRS fire detections for the timing, Sentinel-2 for imagery and burn scars, weather at the fire.
        {liveUpdated && ` Fires burning now are found by scanning every VIIRS pixel on Earth; last scan ${liveUpdated.replace("T", " ")} UTC.`}
      </p>
      <WorldMap worldPath={worldPath} incidents={index} current={cur} onPick={pick} />
      <div className="picker-bar">
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === "live"} className={tab === "live" ? "on" : ""} onClick={() => useStore.getState().set({ pickerTab: "live" })}>
            <span className="live-dot" /> Burning now ({live.length})
          </button>
          <button role="tab" aria-selected={tab === "archive"} className={tab === "archive" ? "on" : ""} onClick={() => useStore.getState().set({ pickerTab: "archive" })}>
            Archive ({archive.length})
          </button>
        </div>
        <label className="find">
          <Icon name="search" size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t("find")}: name, region, country`} aria-label={t("find")} />
        </label>
      </div>
      {tab === "live" && live.length === 0 && <p className="muted">No live scan in this build. The deployed site rescans the planet every few hours.</p>}
      <div className="inc-grid">
        {list.map((i) => (
          <button key={i.id} className={`inc-card ${i.id === cur ? "on" : ""}`} onClick={() => pick(i.id)}>
            {i.thumb ? <img src={`data/${i.thumb}${i.live ? `?v=${encodeURIComponent(i.live.updated)}` : ""}`} alt={`Satellite view of ${i.name}`} decoding="async" /> : <div className="thumb-ph" />}
            <div className="b">
              <b>
                {i.live && <span className="live-tag">LIVE</span>} {i.name}
              </b>
              <div className="muted">{i.region}</div>
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span>{i.live ? `since ${startDate(i.start, lang)}` : startDate(i.start, lang)}</span>·<span>{fmt.area(i.area_ha)}</span>
                <Chip p="derived" />
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                {fmt.num(i.detections)} VIIRS fire pixels
                {i.live ? ` · ${fmt.num(i.live.active_24h)} in the last 24 h` : ""}
                {i.reported_acres ? ` · reported ${fmt.num(i.reported_acres)} acres` : ""}
              </div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function AboutModal({ onClose }: { onClose: () => void }) {
  const b = useStore((s) => s.bundle);
  const fmt = useFmt();
  const m = b?.meta;
  return (
    <Modal onClose={onClose} wide>
      <h2>Methods &amp; sources</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Emberline replays a wildfire from open satellite and station archives. Every number on screen carries its provenance: <Chip p="real" /> measured,{" "}
        <Chip p="derived" /> computed here from measurements, <Chip p="reported" /> published by agencies or press, <Chip p="external" /> third-party layers, <Chip p="sim" /> simulated.
      </p>
      <p>
        <b>Exploratory analysis and training tool.</b> It is not an operational fire-spread prediction or incident-management system, and the drones, aircraft and crews are a simulated rehearsal on top of the real fire.
      </p>

      <h4>1 · When it burned: VIIRS active fire</h4>
      <p>
        Fire pixels come from the NOAA Enterprise Fire product (EFIRE v1r3, VIIRS I-band, 375 m) for the three VIIRS satellites S-NPP, NOAA-20 and NOAA-21, read straight from NOAA's
        open archive on AWS. For each overpass window the pipeline range-reads each granule's footprint, keeps those over the fire and extracts every fire pixel with its time,
        fire radiative power (FRP) and 4 µm brightness temperature. Static thermal anomalies (persistent-anomaly flag) are removed. Up to six overpasses a day look at the fire.
      </p>
      <h4>2 · Where it burned: Sentinel-2 burn scar</h4>
      <p>
        Pre- and post-fire Sentinel-2 L2A composites are built per pixel from the clearest scenes (scene classification mask), and the burn scar is the change in Normalized Burn
        Ratio, dNBR = NBR<sub>pre</sub> − NBR<sub>post</sub> (NBR from bands 8 and 12). A pixel is burned where dNBR ≥ 0.1 (USGS low-severity threshold) within 1.5 km of VIIRS fire;
        wetlands in the dry season brown everywhere, so the Pantanal uses dNBR ≥ 0.27 and post-fire NBR ≤ 0. Where Sentinel-2 had no clear view the VIIRS footprint is kept.
      </p>
      <h4>3 · Arrival time</h4>
      <p>
        Each VIIRS pixel paints its 375 m footprint on a 40–100 m grid; after every overpass the burned area is the morphological closing of everything seen so far. Cells that
        appear at overpass <i>k</i> get a time between the previous look and <i>k</i>, in proportion to their distance from the previous burned area (constant front speed between
        looks). Burn-scar cells take the time of the nearest VIIRS cell. The front shown on the map is everything that ignited in the last 12 hours.
      </p>
      {m && (
        <table>
          <tbody>
            <tr>
              <th>This incident</th>
              <th>Value</th>
            </tr>
            <tr>
              <td>Fire pixels / overpasses with fire</td>
              <td>
                {fmt.num(m.stats.detections)} / {m.stats.overpasses_with_fire} of {m.stats.overpasses}
              </td>
            </tr>
            <tr>
              <td>Burned area (derived) vs. VIIRS footprints alone</td>
              <td>
                {fmt.area(m.stats.area_ha)} vs. {fmt.area(m.method.viirs_only_area_ha)}
              </td>
            </tr>
            {m.reported.final_acres && (
              <tr>
                <td>Reported final area (check)</td>
                <td>
                  {fmt.num(m.reported.final_acres)} acres · derived {fmt.num(m.stats.area_ha / 0.404686)} acres ({(((m.stats.area_ha / 0.404686 - m.reported.final_acres) / m.reported.final_acres) * 100).toFixed(1)}%)
                </td>
              </tr>
            )}
            <tr>
              <td>Grid</td>
              <td>
                {m.grid.width} × {m.grid.height} cells at {m.grid.res_m} m (EPSG:3857)
              </td>
            </tr>
            {m.imagery && (
              <tr>
                <td>Sentinel-2 scenes</td>
                <td>
                  before: {uniqueDates(m.imagery.pre.scenes)} ({m.imagery.pre.scenes.length} scenes, {m.imagery.pre.clear_pct}% clear) · after: {uniqueDates(m.imagery.post.scenes)} ({m.imagery.post.scenes.length} scenes, {m.imagery.post.clear_pct}% clear)
                </td>
              </tr>
            )}
            {b?.weather && (
              <tr>
                <td>Weather station</td>
                <td>
                  {b.weather.station.name} ({b.weather.station.id})
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <h4>4 · Hot spots</h4>
      <p>
        The fire pixels of each overpass are grouped into clusters (1.2 km linking), and clusters are linked to the nearest cluster within 4 km seen in the previous 36 h. A track
        is <i>new</i> for 6 h, <i>intensifying</i> when its FRP rises by 25%, <i>cooling</i> 14 h after its last sighting and drops off after 30 h.
      </p>
      <h4>5 · Weather</h4>
      <p>
        Hourly wind, gusts, temperature and humidity (from dew point) come from the nearest airport in NOAA's Integrated Surface Database. METAR remarks that mention the fire or
        smoke (FU) appear as events. Smoke on the map drifts with the observed wind.
      </p>
      <h4>6 · Simulated response</h4>
      <p>
        Drones are tasked at every overpass to the strongest tracked hot spots and orbit them; their camera renders the real arrival-time and severity grids as a thermal image
        (temperatures are illustrative). Aircraft fly drop cycles from the real air base to the most active hot spots in daylight; crews and dozers build line from the heel of the
        fire. Containment follows reported values where they exist (interpolated between them) and is otherwise simulated. None of this is a record of the real response.
      </p>
      <h4>Sources &amp; licences</h4>
      <ul>
        <li>NOAA JPSS VIIRS Enterprise Active Fire (EFIRE), NOAA Open Data Dissemination on AWS: public domain.</li>
        <li>Copernicus Sentinel-2 L2A (contains modified Copernicus Sentinel data), Cloud-Optimized GeoTIFFs by Element 84 on AWS.</li>
        <li>NOAA NCEI Integrated Surface Database (Global Hourly) on AWS: public domain.</li>
        <li>AWS Terrain Tiles (Mapzen terrarium; SRTM, USGS 3DEP and others).</li>
        <li>Basemap imagery and place labels © Esri and its partners.</li>
        {(m?.reported.sources ?? []).map((s) => (
          <li key={s.url}>
            Reported facts: <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
          </li>
        ))}
      </ul>
      <p className="muted">Keyboard: Space play/pause · ←/→ one hour (Shift: one day) · [ / ] events · , / . satellite passes · 1/2/3 modes · R reset view · Esc close.</p>
    </Modal>
  );
}

/** Calendar start date of an incident (its UTC date), independent of the open incident's time zone. */
function startDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`));
}

function uniqueDates(scenes: { date: string }[]): string {
  return [...new Set(scenes.map((s) => s.date))].sort().join(", ");
}

const FIRMS_SOURCES = ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT", "MODIS_NRT"];

interface EonetEvent {
  id: string;
  title: string;
  geometry: { date: string; coordinates: [number, number] }[];
}

function LiveModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [key, setKey] = useState(() => {
    try {
      return localStorage.getItem("firms_key") ?? "";
    } catch {
      return "";
    }
  });
  const [src, setSrc] = useState(FIRMS_SOURCES[0]);
  const [days, setDays] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const [events, setEvents] = useState<EonetEvent[] | null>(null);

  useEffect(() => {
    fetch("https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=40")
      .then((r) => r.json())
      .then((j) => setEvents(j.events ?? []))
      .catch(() => setEvents([]));
  }, []);

  const load = async () => {
    const map = (window as unknown as { __map?: import("maplibre-gl").Map }).__map;
    if (!map || !key) return;
    try {
      localStorage.setItem("firms_key", key);
    } catch {
      /* private mode */
    }
    const bnd = map.getBounds();
    const area = [bnd.getWest(), bnd.getSouth(), bnd.getEast(), bnd.getNorth()].map((v) => v.toFixed(3)).join(",");
    setMsg("Loading…");
    try {
      const r = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${src}/${area}/${days}`);
      const txt = await r.text();
      if (!r.ok || !txt.startsWith("latitude")) throw new Error(txt.slice(0, 160) || `HTTP ${r.status}`);
      const lines = txt.trim().split("\n");
      const head = lines[0].split(",");
      const iLat = head.indexOf("latitude");
      const iLon = head.indexOf("longitude");
      const iFrp = head.indexOf("frp");
      const iDate = head.indexOf("acq_date");
      const iTime = head.indexOf("acq_time");
      const feats = lines.slice(1).map((l) => {
        const c = l.split(",");
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [Number(c[iLon]), Number(c[iLat])] },
          properties: { frp: Number(c[iFrp]), when: `${c[iDate]} ${c[iTime]}` },
        };
      });
      const fc = { type: "FeatureCollection" as const, features: feats };
      if (map.getSource("live")) (map.getSource("live") as import("maplibre-gl").GeoJSONSource).setData(fc);
      else {
        map.addSource("live", { type: "geojson", data: fc });
        map.addLayer({
          id: "live",
          type: "circle",
          source: "live",
          paint: { "circle-radius": 4, "circle-color": "#00e5ff", "circle-stroke-color": "#003b47", "circle-stroke-width": 1 },
        });
      }
      setMsg(`${feats.length} live detections loaded (cyan) from ${src}, last ${days} day(s).`);
    } catch (e) {
      setMsg(`Could not load FIRMS: ${(e as Error).message}`);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2>{t("live_title")}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Overlay near-real-time detections on the current view straight from NASA FIRMS. Your key stays in this browser.{" "}
        <a href="https://firms.modaps.eosdis.nasa.gov/api/map_key/" target="_blank" rel="noreferrer">
          {t("live_get_key")}
        </a>
      </p>
      <label className="field">
        {t("live_key")}
        <input value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="32-character key" />
      </label>
      <div style={{ display: "flex", gap: 10 }}>
        <label className="field" style={{ flex: 2 }}>
          {t("live_source")}
          <select value={src} onChange={(e) => setSrc(e.target.value)}>
            {FIRMS_SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: 1 }}>
          {t("live_days")}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 2, 3, 5, 10].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>
      <button className="btn primary" disabled={!key} onClick={load}>
        <Icon name="download" size={14} /> {t("live_fetch")}
      </button>
      {msg && <p className="note">{msg}</p>}
      <h4>{t("live_events")}</h4>
      {events == null && <p className="muted">Loading…</p>}
      {events && events.length === 0 && <p className="muted">{t("live_none")}</p>}
      <div className="list" style={{ maxHeight: 260, overflowY: "auto" }}>
        {events?.map((e) => {
          const g = e.geometry[e.geometry.length - 1];
          return (
            <button
              key={e.id}
              className="row"
              onClick={() => {
                useStore.getState().flyTo({ center: g.coordinates, zoom: 10, pitch: 45, duration: 2500 });
                onClose();
              }}
            >
              <span className="ico">
                <Icon name="flame" size={15} />
              </span>
              <span>
                <span className="t1">{e.title}</span>
                <span className="t2">{g.date.slice(0, 10)}</span>
              </span>
              <span className="r">
                <Icon name="pin" size={14} />
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
