import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useStore, type LayerId } from "../store";
import { FireCanvas } from "./fireCanvas";
import { Scene3D, type ObjKind, type SceneFrame, type ScreenLabel } from "./scene3d";
import { activeHotspots, cellAt, detectionRange, FRONT_WINDOW_S, windToward } from "../data/analytics";
import { daylight, sunPosition } from "../lib/sun";
import { opsAt } from "../sim/ops";
import { getSims } from "../sim/registry";
import { MapHud } from "../ui/MapHud";

const IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const PLACES = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const DEM = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      imagery: { type: "raster", tiles: [IMAGERY], tileSize: 256, maxzoom: 18, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" },
      places: { type: "raster", tiles: [PLACES], tileSize: 256, maxzoom: 18 },
      dem: { type: "raster-dem", tiles: [DEM], tileSize: 256, maxzoom: 14, encoding: "terrarium", attribution: "Terrain: AWS Terrain Tiles (Mapzen)" },
      hill: { type: "raster-dem", tiles: [DEM], tileSize: 256, maxzoom: 14, encoding: "terrarium" },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#2a2620" } },
      { id: "imagery", type: "raster", source: "imagery", paint: { "raster-fade-duration": 150 } },
    ],
    sky: {
      "sky-color": "#b8d3ea",
      "horizon-color": "#f3e6d3",
      "fog-color": "#efe4d4",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.7,
      "fog-ground-blend": 0.25,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 1, 12, 0],
    },
  };
}

const RASTER_LAYERS: LayerId[] = ["imagery", "s2pre", "s2post"];

function lerpColor(a: number[], b: number[], t: number) {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const labelsEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const bundle = useStore((s) => s.bundle);

  useEffect(() => {
    if (!el.current || !bundle) return;
    const b = bundle;
    const st = useStore.getState();
    const [w, s, e, n] = b.meta.bbox;
    const map = new maplibregl.Map({
      container: el.current,
      style: baseStyle(),
      bounds: [w, s, e, n],
      fitBoundsOptions: { padding: 40 },
      pitch: st.view3d ? 52 : 0,
      bearing: -12,
      maxPitch: 82,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true, preserveDrawingBuffer: false },
    });
    mapRef.current = map;
    (window as unknown as { __map: maplibregl.Map }).__map = map;
    map.addControl(new maplibregl.ScaleControl({ unit: st.units === "imperial" ? "imperial" : "metric" }), "bottom-right");

    const fire = new FireCanvas(b.arrival);
    const scene = new Scene3D(b.meta.center);
    (window as unknown as { __scene: Scene3D }).__scene = scene;
    const { drones, ops } = getSims(b);
    const labelNodes = new Map<string, HTMLDivElement>();
    let lastPaintKey = "";
    let lastDetKey = -1;
    let lastOpsKey = -1;
    let lastPerimKey = -1;
    let raf = 0;
    let ready = false;
    let lastT = NaN;
    let lastGeoWall = 0; // wall-clock throttle for GeoJSON uploads during playback
    let lastNightKey = -1;

    // "style.load" (not "load"): "load" waits for basemap tiles, and must not block the fire
    // layers when a third-party tile server is slow or blocked.
    const onStyle = () => {
      if (ready) return;
      try {
        setupLayers();
      } catch (err) {
        console.error("Emberline: layer setup failed", err);
      }
    };
    if (map.isStyleLoaded()) setTimeout(onStyle, 0);
    else map.once("style.load", onStyle);

    function setupLayers() {
      const im = b.meta.imagery;
      const gridCorners = b.meta.grid.corners as [[number, number], [number, number], [number, number], [number, number]];
      if (im) {
        const c = im.corners as [[number, number], [number, number], [number, number], [number, number]];
        map.addSource("s2pre", { type: "image", url: b.base + "s2_pre.jpg" + b.version, coordinates: c });
        map.addSource("s2post", { type: "image", url: b.base + "s2_post.jpg" + b.version, coordinates: c });
        map.addLayer({ id: "s2pre", type: "raster", source: "s2pre", paint: { "raster-fade-duration": 0 } });
        map.addLayer({ id: "s2post", type: "raster", source: "s2post", paint: { "raster-fade-duration": 0 } });
      }
      map.addLayer({
        id: "hillshade",
        type: "hillshade",
        source: "hill",
        paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#2b1d10", "hillshade-highlight-color": "#fff8ec", "hillshade-accent-color": "#5c4630" },
      });
      map.addSource("fire", { type: "canvas", canvas: fire.canvas, coordinates: gridCorners, animate: false });
      map.addLayer({ id: "fire", type: "raster", source: "fire", paint: { "raster-resampling": "linear", "raster-fade-duration": 0 } });

      map.addSource("perimeters", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "perimeters",
        type: "line",
        source: "perimeters",
        paint: {
          "line-color": ["interpolate", ["linear"], ["get", "k"], 0, "#ffe066", 0.5, "#f76707", 1, "#c92a2a"],
          "line-width": ["case", ["get", "latest"], 2.4, 1.1],
          "line-opacity": 0.9,
        },
      });
      map.addSource("containment", { type: "geojson", data: emptyFC() });
      map.addLayer({ id: "containment-casing", type: "line", source: "containment", paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.85 }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addLayer({ id: "containment", type: "line", source: "containment", paint: { "line-color": "#212529", "line-width": 3, "line-dasharray": [2, 1] }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addSource("drops", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "drops",
        type: "line",
        source: "drops",
        paint: {
          "line-color": ["case", ["==", ["get", "agent"], "retardant"], "#ff2f4f", "#4dabf7"],
          "line-width": ["interpolate", ["exponential", 2], ["zoom"], 8, 3, 10, 6, 12, 14, 15, 60],
          "line-opacity": ["*", 0.9, ["get", "fade"]],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 6],
        },
        layout: { "line-cap": "round" },
      });
      map.addSource("detections", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "detections-glow",
        type: "circle",
        source: "detections",
        paint: {
          "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 6, 2, 10, 7, 16, 420],
          "circle-color": ["interpolate", ["linear"], ["get", "age"], 0, "#fff3bf", 0.1, "#ffa94d", 0.5, "#e8590c"],
          "circle-blur": 1,
          "circle-opacity": ["interpolate", ["linear"], ["get", "age"], 0, 0.55, 0.25, 0.25, 0.5, 0],
          "circle-pitch-alignment": "map",
        },
      });
      map.addLayer({
        id: "detections",
        type: "circle",
        source: "detections",
        paint: {
          // ~ the 375 m VIIRS footprint: radius doubles with each zoom level
          "circle-radius": [
            "interpolate", ["exponential", 2], ["zoom"],
            6, 0.9,
            9, ["*", 1.3, ["-", 1, ["*", 0.45, ["get", "age"]]]],
            10, ["*", 2, ["-", 1, ["*", 0.5, ["get", "age"]]]],
            16, ["*", 120, ["-", 1, ["*", 0.5, ["get", "age"]]]],
          ],
          "circle-color": ["interpolate", ["linear"], ["get", "age"], 0, "#ffffff", 0.1, "#ffe066", 0.3, "#ff922b", 0.6, "#e03131", 1, "#862e2e"],
          "circle-stroke-color": "rgba(40,10,5,0.6)",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 0, 13, 0.8],
          "circle-opacity": ["interpolate", ["linear"], ["get", "age"], 0, 1, 0.5, 0.75, 1, 0.35],
          "circle-pitch-alignment": "map",
        },
      });
      map.addLayer({ id: "places", type: "raster", source: "places", paint: { "raster-opacity": 0.9 } });
      map.addLayer(scene);
      scene.onLabels = applyLabels;
      ready = true;
      // start with the attribution collapsed to its (i) button so it never covers the map controls
      setTimeout(() => el.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"), 50);
      applyView();
      applyLayers();
      frame(true);
    }

    // Greedy label placement: selected first, then labels of the current mode; overlapping ones hide.
    const widths = new Map<string, number>();
    function applyLabels(list: ScreenLabel[]) {
      const host = labelsEl.current;
      if (!host) return;
      const seen = new Set<string>();
      const cand: { l: ScreenLabel; node: HTMLDivElement; prio: number }[] = [];
      for (const l of list) {
        const node = labelNodes.get(l.id);
        if (!node) continue;
        seen.add(l.id);
        const cls = node.className;
        if (!l.visible || cls.includes(" dim")) {
          node.style.display = "none";
          continue;
        }
        const prio = cls.includes(" sel") ? 3 : cls.includes("hot") ? 1 : cls.includes("ground") ? 0.5 : 2;
        cand.push({ l, node, prio });
      }
      cand.sort((a, z) => z.prio - a.prio);
      const placed: [number, number, number, number][] = [];
      for (const { l, node } of cand) {
        let w = widths.get(l.id);
        if (w === undefined) {
          node.style.display = "";
          w = node.offsetWidth || 80;
          widths.set(l.id, w);
        }
        const box: [number, number, number, number] = [l.x - 6, l.y - 26, l.x + w, l.y - 6];
        const hit = placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1]);
        if (hit) {
          node.style.display = "none";
          continue;
        }
        placed.push(box);
        node.style.display = "";
        node.style.transform = `translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px)`;
      }
      for (const [id, node] of labelNodes) if (!seen.has(id)) node.style.display = "none";
    }

    function ensureLabel(id: string, text: string, sub: string | undefined, cls: string, onClick?: () => void) {
      const host = labelsEl.current;
      if (!host) return;
      let node = labelNodes.get(id);
      if (!node) {
        node = document.createElement("div");
        node.className = "map-label";
        node.innerHTML = `<span class="ml-pin"></span><span class="ml-body"><b></b><i></i></span>`;
        host.appendChild(node);
        labelNodes.set(id, node);
        if (onClick) {
          node.addEventListener("click", (ev) => {
            ev.stopPropagation();
            onClick();
          });
        }
      }
      const full = `map-label ${cls}`;
      if (node.className !== full) node.className = full;
      const bEl = node.querySelector("b")!;
      const iEl = node.querySelector("i")!;
      if (bEl.textContent !== text) bEl.textContent = text;
      const s2 = sub ?? "";
      if (iEl.textContent !== s2) iEl.textContent = s2;
      if (bEl.textContent !== text || node.dataset.sub !== s2) widths.delete(id);
      node.dataset.sub = s2;
    }

    function applyView() {
      if (!ready) return;
      const s2 = useStore.getState();
      if (s2.view3d && s2.layers.terrain.on) {
        map.setTerrain({ source: "dem", exaggeration: s2.exaggeration });
      } else {
        map.setTerrain(null);
      }
      scene.invalidateElevation();
    }

    function applyLayers() {
      if (!ready) return;
      const L = useStore.getState().layers;
      const cmp = useStore.getState().compare;
      const vis = (id: string, on: boolean) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      };
      vis("imagery", L.imagery.on);
      if (map.getLayer("imagery")) map.setPaintProperty("imagery", "raster-opacity", L.imagery.opacity);
      if (cmp != null) {
        vis("s2pre", true);
        vis("s2post", true);
        map.setPaintProperty("s2pre", "raster-opacity", 1);
        map.setPaintProperty("s2post", "raster-opacity", cmp);
      } else {
        for (const id of ["s2pre", "s2post"] as const) {
          vis(id, L[id].on);
          if (map.getLayer(id)) map.setPaintProperty(id, "raster-opacity", L[id].opacity);
        }
      }
      vis("hillshade", L.terrain.on);
      vis("perimeters", L.perimeters.on);
      if (map.getLayer("perimeters")) map.setPaintProperty("perimeters", "line-opacity", L.perimeters.opacity);
      vis("detections", L.detections.on);
      vis("detections-glow", L.detections.on);
      if (map.getLayer("detections")) {
        const k = L.detections.opacity;
        map.setPaintProperty("detections-glow", "circle-opacity", ["interpolate", ["linear"], ["get", "age"], 0, 0.55 * k, 0.25, 0.25 * k, 0.5, 0]);
        map.setPaintProperty("detections", "circle-opacity", ["interpolate", ["linear"], ["get", "age"], 0, k, 0.5, 0.75 * k, 1, 0.35 * k]);
      }
      const opsOn = L.ops.on;
      for (const id of ["containment", "containment-casing", "drops"]) vis(id, opsOn);
      vis("places", L.labels.on);
      lastPaintKey = "";
      lastDetKey = -1;
      lastOpsKey = -1;
      lastPerimKey = -1;
      frame(true);
    }

    function frame(force = false) {
      if (!ready) return;
      const s2 = useStore.getState();
      const t = s2.time;
      const L = s2.layers;
      const [lon, lat] = b.meta.center;
      const day = daylight(t, lon, lat);
      const night = 1 - day;
      const sun = sunPosition(t, lon, lat);

      if (!force && t === lastT && !s2.follow) return;
      lastT = t;

      // basemap day/night (only when the light changes noticeably)
      const nk = Math.round(night * 40) * 1000 + Math.round(sun.azimuth / 10);
      if (force || nk !== lastNightKey) {
        lastNightKey = nk;
        const bright = 0.32 + 0.68 * day;
        for (const id of RASTER_LAYERS) {
          if (map.getLayer(id)) {
            map.setPaintProperty(id, "raster-brightness-max", bright);
            map.setPaintProperty(id, "raster-saturation", -0.35 * night);
          }
        }
        if (map.getLayer("hillshade")) map.setPaintProperty("hillshade", "hillshade-illumination-direction", Math.round(sun.azimuth) % 360);
        map.setSky({
          "sky-color": lerpColor([184, 211, 234], [16, 20, 38], night),
          "horizon-color": lerpColor([243, 230, 211], [58, 40, 52], night),
          "fog-color": lerpColor([239, 228, 212], [30, 26, 34], night),
        });
      }

      // fire raster
      const front = L.front.on ? L.front.opacity : 0;
      const key = [Math.floor(t / 120), L.burned.on, L.burned.opacity, front, L.progression.on, L.severity.on, Math.round(night * 10)].join("|");
      if (force || key !== lastPaintKey) {
        lastPaintKey = key;
        fire.paint({
          time: t,
          t0: b.meta.t0_epoch,
          t1: Date.parse(b.meta.end) / 1000,
          burned: L.burned.on ? L.burned.opacity : 0,
          front,
          progression: L.progression.on ? L.progression.opacity : 0,
          severity: L.severity.on ? L.severity.opacity : 0,
          night,
          frontWindow: FRONT_WINDOW_S,
        });
        const src = map.getSource("fire") as maplibregl.CanvasSource | undefined;
        if (src) {
          src.play();
          requestAnimationFrame(() => src.pause());
        }
      }

      // GeoJSON sources go through a worker: refresh at most ~8 times a second while playing
      const wall = performance.now();
      const geoOk = force || wall - lastGeoWall > 120;

      // satellite detections (last 12 h)
      const dk = Math.floor(t / 300);
      if (L.detections.on && geoOk && (force || dk !== lastDetKey)) {
        lastGeoWall = wall;
        lastDetKey = dk;
        const [i0, i1] = detectionRange(b, t, FRONT_WINDOW_S);
        const d = b.detections;
        const feats: GeoJSON.Feature[] = [];
        for (let i = i0; i < i1; i++) {
          const age = (t - (b.meta.t0_epoch + d.t[i] * 60)) / FRONT_WINDOW_S;
          feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [d.lon[i], d.lat[i]] }, properties: { age, frp: d.frp[i] } });
        }
        (map.getSource("detections") as GeoJSONSource).setData({ type: "FeatureCollection", features: feats });
      }

      // daily perimeters up to t
      const pk = Math.floor(t / 3600);
      if (L.perimeters.on && geoOk && (force || pk !== lastPerimKey)) {
        lastPerimKey = pk;
        const feats = b.perimeters.features.filter((f) => f.properties.t - 86400 <= t);
        const nF = b.perimeters.features.length;
        (map.getSource("perimeters") as GeoJSONSource).setData({
          type: "FeatureCollection",
          features: feats.map((f, i) => ({ ...f, properties: { ...f.properties, k: nF > 1 ? b.perimeters.features.indexOf(f) / (nF - 1) : 0, latest: i === feats.length - 1 } })) as GeoJSON.Feature[],
        });
      }

      // operations
      const opsFrame = opsAt(ops, b, t);
      const ok = Math.floor(t / 60);
      if (L.ops.on && geoOk && (force || ok !== lastOpsKey)) {
        lastGeoWall = wall;
        lastOpsKey = ok;
        (map.getSource("containment") as GeoJSONSource).setData(
          opsFrame.line ? { type: "Feature", geometry: { type: "LineString", coordinates: opsFrame.line }, properties: {} } : emptyFC(),
        );
        const drops = ops.dropsUntil(t).filter((x) => t - x.t < 36 * 3600);
        (map.getSource("drops") as GeoJSONSource).setData({
          type: "FeatureCollection",
          features: drops.map((x) => ({
            type: "Feature",
            geometry: { type: "LineString", coordinates: x.line },
            properties: { agent: x.agent, fade: Math.max(0.15, 1 - (t - x.t) / (36 * 3600)) },
          })),
        });
      }

      // 3D scene frame
      const mode = s2.mode;
      const objects: SceneFrame["objects"] = [];
      const groundLabels: SceneFrame["groundLabels"] = [];
      const showDrones = mode === "drones" || (L.ops.on && mode !== "resources");
      if (showDrones) {
        for (const d of drones.all(t)) {
          if (d.status === "standby") continue;
          const sel = s2.selectedDrone === d.spec.id;
          objects.push({ id: d.spec.id, kind: d.spec.kind as ObjKind, lnglat: d.pos, altAgl: d.altAgl, heading: d.heading, color: d.spec.color, selected: sel, label: d.spec.id, sublabel: d.spec.name });
          ensureLabel(d.spec.id, d.spec.id, d.spec.name, `drone${sel ? " sel" : ""}${mode !== "drones" ? " dim" : ""}`, () => {
            useStore.getState().set({ mode: "drones", selectedDrone: d.spec.id, cameraOpen: true });
          });
        }
      }
      if (L.ops.on && mode !== "drones") {
        for (const u of opsFrame.units) {
          const sel = s2.selectedUnit === u.spec.id;
          if (u.spec.group === "air") {
            if (!u.airborne) continue;
            const kind: ObjKind = u.spec.kind === "heli" ? "heli" : u.spec.kind === "seat" ? "seat" : u.spec.kind === "vlat" ? "vlat" : u.spec.kind === "airattack" ? "airattack" : "tanker";
            const color = u.spec.kind === "seat" ? "#f2c94c" : u.spec.kind === "airattack" ? "#868e96" : u.spec.kind === "heli" ? "#d9480f" : "#c92a2a";
            objects.push({
              id: u.spec.id, kind, lnglat: u.pos, altAgl: u.altAgl, heading: u.heading, color, selected: sel, label: u.spec.id,
              dropping: u.status === "dropping" ? u.spec.agent : null,
            });
            ensureLabel(u.spec.id, u.spec.id, u.spec.name, `air${sel ? " sel" : ""}${mode !== "resources" ? " dim" : ""}`, () =>
              useStore.getState().set({ mode: "resources", selectedUnit: u.spec.id }),
            );
          } else if (mode === "resources") {
            groundLabels.push({ id: u.spec.id, lnglat: u.pos, label: u.spec.id, cls: u.spec.group });
            ensureLabel(u.spec.id, u.spec.id, u.status === "staged" ? "staged" : u.spec.name, `ground ${u.spec.group}${sel ? " sel" : ""}`, () =>
              useStore.getState().set({ selectedUnit: u.spec.id }),
            );
          }
        }
      }
      if (mode === "resources" || mode === "drones") {
        groundLabels.push({ id: "icp", lnglat: b.meta.icp.lonlat, label: "ICP", cls: "icp" });
        ensureLabel("icp", mode === "drones" ? "Drone ops" : "ICP", b.meta.icp.name, "icp");
        groundLabels.push({ id: "base", lnglat: b.meta.base.lonlat, label: "Air base", cls: "base" });
        ensureLabel("base", "Air base", b.meta.base.name, "base");
      }

      const hs = L.hotspots.on && mode !== "resources" ? activeHotspots(b, t).slice(0, mode === "drones" ? 12 : 8) : [];
      const maxFrp = Math.max(1, ...hs.map((h) => h.frp));
      const beacons = hs.map((h) => {
        const sel = s2.selectedHotspot === h.id;
        const lbl = mode === "drones" || sel;
        if (lbl) ensureLabel(h.id, h.id, `${Math.round(h.frp)} MW`, `hot ${h.status}${sel ? " sel" : ""}`, () => useStore.getState().set({ selectedHotspot: h.id }));
        return {
          id: h.id,
          lnglat: h.pos,
          strength: Math.min(1, h.frp / maxFrp),
          color: h.status === "cooling" ? "#ffa94d" : h.status === "new" ? "#ffe066" : "#ff4d1a",
          label: lbl ? h.id : undefined,
          selected: sel,
        };
      });

      const wind = windToward(b, t);
      const smokeSrc = L.smoke.on ? activeHotspots(b, t).slice(0, 10).map((h) => ({ lnglat: h.pos, strength: Math.min(1, Math.sqrt(h.frp / maxFrp)) })) : [];
      scene.setSun(sun.azimuth, sun.altitude, night);
      scene.frame = {
        time: t,
        objects,
        beacons,
        smoke: smokeSrc,
        smokeOpacity: L.smoke.on ? L.smoke.opacity : 0,
        windToward: wind.toward,
        windKmh: wind.kmh,
        night,
        groundLabels,
      };

      // follow / chase / ride-along camera
      const fol = s2.follow;
      if (fol) {
        const o = objects.find((x) => x.id === fol) ?? null;
        const gu = opsFrame.units.find((u) => u.spec.id === fol);
        const target = o?.lnglat ?? gu?.pos;
        if (target) {
          const c = map.getCenter();
          const k = 0.12;
          map.jumpTo({ center: [c.lng + (target[0] - c.lng) * k, c.lat + (target[1] - c.lat) * k] });
        }
      }
      map.triggerRepaint();
    }

    const loop = () => {
      frame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // hover readout
    let hoverT = 0;
    map.on("mousemove", (ev) => {
      const now = performance.now();
      if (now - hoverT < 40) return;
      hoverT = now;
      const { lng, lat } = ev.lngLat;
      const cell = cellAt(b, lng, lat);
      const exag = map.getTerrain()?.exaggeration ?? 1;
      const elev = map.getTerrain() ? (map.queryTerrainElevation([lng, lat]) ?? 0) / exag : null;
      useStore.getState().set({
        hover: { x: ev.point.x, y: ev.point.y, lon: lng, lat, elev, arrival: cell?.arrival ?? null, severity: cell?.severity ?? null },
      });
    });
    map.on("mouseout", () => useStore.getState().set({ hover: null }));
    map.on("dragstart", () => {
      if (useStore.getState().follow) useStore.getState().set({ follow: null });
    });

    const unsub = useStore.subscribe((s, p) => {
      if (s.layers !== p.layers || s.compare !== p.compare) applyLayers();
      if (s.view3d !== p.view3d || s.exaggeration !== p.exaggeration) {
        applyView();
        map.easeTo({ pitch: s.view3d ? 55 : 0, duration: 700 });
      }
      if (s.mode !== p.mode || s.selectedDrone !== p.selectedDrone || s.selectedUnit !== p.selectedUnit) frame(true);
      if (s.camera && s.camera !== p.camera) {
        const c = s.camera;
        if (c.bounds) {
          map.fitBounds(c.bounds, { padding: 60, duration: c.duration ?? 1400, pitch: c.pitch ?? map.getPitch(), bearing: c.bearing ?? map.getBearing() });
        } else {
          map.flyTo({ center: c.center ?? map.getCenter(), zoom: c.zoom ?? map.getZoom(), pitch: c.pitch ?? map.getPitch(), bearing: c.bearing ?? map.getBearing(), duration: c.duration ?? 1600, essential: true });
        }
      }
      if (s.theme !== p.theme) frame(true);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current);

    return () => {
      cancelAnimationFrame(raf);
      unsub();
      ro.disconnect();
      labelNodes.forEach((n) => n.remove());
      map.remove();
      mapRef.current = null;
    };
  }, [bundle]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      <div ref={labelsEl} className="map-labels" />
      <MapHud mapRef={mapRef} />
    </div>
  );
}
