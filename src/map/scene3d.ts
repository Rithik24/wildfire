// three.js custom layer: aircraft, drones, hot-spot beacons, smoke plumes and drop curtains,
// rendered in MapLibre's camera so they sit on the 3D terrain. Positions are given in lon/lat +
// metres above ground; the layer resolves ground elevation itself.

import * as THREE from "three";
import maplibregl, { type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from "maplibre-gl";

export type ObjKind = "quad" | "hexa" | "vtol" | "tanker" | "seat" | "heli" | "airattack" | "vlat";

export interface SceneObject {
  id: string;
  kind: ObjKind;
  lnglat: [number, number];
  altAgl: number;
  heading: number;
  color: string;
  selected: boolean;
  label: string;
  sublabel?: string;
  dropping?: "retardant" | "water" | null;
}

export interface Beacon {
  id: string;
  lnglat: [number, number];
  strength: number; // 0..1
  color: string;
  label?: string;
  selected?: boolean;
}

export interface SmokeSource {
  lnglat: [number, number];
  strength: number; // 0..1
}

export interface SceneFrame {
  time: number;
  objects: SceneObject[];
  beacons: Beacon[];
  smoke: SmokeSource[];
  smokeOpacity: number;
  windToward: number; // deg
  windKmh: number;
  night: number;
  groundLabels: { id: string; lnglat: [number, number]; label: string; cls: string }[];
}

export interface ScreenLabel {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

const SMOKE_PER_SOURCE = 90;
const MAX_SOURCES = 10;
const CURTAIN_PER_AIRCRAFT = 70;

function mat(color: string, emissive = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, emissive: color, emissiveIntensity: emissive });
}

function buildModel(kind: ObjKind, color: string): THREE.Group {
  const g = new THREE.Group();
  const body = mat(color, 0.15);
  const dark = mat("#2b2f36");
  const light = mat("#f1f3f5");
  const rotor = new THREE.MeshBasicMaterial({ color: "#dee2e6", transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  if (kind === "quad" || kind === "hexa") {
    const arms = kind === "hexa" ? 6 : 4;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.16), body));
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2 + Math.PI / arms;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.05), dark);
      arm.position.set(Math.cos(a) * 0.31, Math.sin(a) * 0.31, 0.04);
      arm.rotation.z = a;
      g.add(arm);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.2, 18), rotor);
      disc.position.set(Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0.1);
      g.add(disc);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), dark);
      motor.rotation.x = Math.PI / 2;
      motor.position.set(Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0.06);
      g.add(motor);
    }
    const cam = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), dark);
    cam.position.set(0, 0.16, -0.1);
    g.add(cam);
  } else if (kind === "heli") {
    const fus = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), body);
    fus.scale.set(0.75, 1.4, 0.7);
    g.add(fus);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), body);
    boom.position.set(0, -0.95, 0.08);
    g.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.3), body);
    fin.position.set(0, -1.45, 0.22);
    g.add(fin);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 28), rotor);
    disc.position.set(0, 0, 0.36);
    g.add(disc);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.16, 10), mat("#e8590c"));
    bucket.rotation.x = Math.PI / 2;
    bucket.position.set(0, 0, -0.75);
    g.add(bucket);
  } else {
    // fixed wing: tankers, SEATs, air attack, VTOL survey drones
    const isDrone = kind === "vtol";
    const len = kind === "vlat" ? 1.9 : kind === "tanker" ? 1.6 : 1.2;
    const span = kind === "vlat" ? 1.85 : kind === "tanker" ? 1.75 : isDrone ? 1.6 : 1.3;
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, len, 12), isDrone ? light : body);
    g.add(fus); // cylinder axis = local Y = forward
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 12), isDrone ? light : body);
    nose.position.y = len / 2 + 0.11;
    g.add(nose);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(span, 0.24, 0.035), isDrone ? body : light);
    wing.position.set(0, len * 0.08, kind === "seat" || isDrone ? 0.07 : -0.02);
    g.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(span * 0.36, 0.14, 0.03), isDrone ? body : light);
    tail.position.set(0, -len / 2 + 0.08, 0.02);
    g.add(tail);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.26), body);
    fin.position.set(0, -len / 2 + 0.08, 0.15);
    g.add(fin);
    if (kind === "tanker" || kind === "vlat") {
      for (const side of [-1, 1]) {
        const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10), dark);
        eng.position.set(side * span * 0.25, len * 0.14, -0.07);
        g.add(eng);
      }
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.093, 0.093, len * 0.25, 12), light);
      stripe.position.y = -len * 0.12;
      g.add(stripe);
    }
    if (isDrone) {
      for (const side of [-1, 1]) {
        const boom = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.04), dark);
        boom.position.set(side * 0.42, 0.05, 0.05);
        g.add(boom);
        for (const fy of [-0.3, 0.42]) {
          const d = new THREE.Mesh(new THREE.CircleGeometry(0.13, 14), rotor);
          d.position.set(side * 0.42, fy, 0.1);
          g.add(d);
        }
      }
    }
  }
  return g;
}

const smokeVS = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uPxPerM;
  uniform float uFocal;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 p = projectionMatrix * vec4(position, 1.0);
    gl_Position = p;
    gl_PointSize = clamp(aSize * uPxPerM * uFocal / max(p.w, 1e-6), 1.0, 380.0);
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;

const smokeFS = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float a = (1.0 - d) * (1.0 - d) * vAlpha;
    gl_FragColor = vec4(vColor, a);
  }
`;

function particles(n: number, blending: THREE.Blending) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const m = new THREE.ShaderMaterial({
    vertexShader: smokeVS,
    fragmentShader: smokeFS,
    uniforms: { uPxPerM: { value: 1 }, uFocal: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending,
  });
  const pts = new THREE.Points(geo, m);
  pts.frustumCulled = false;
  return pts;
}

function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class Scene3D implements CustomLayerInterface {
  id = "scene3d";
  type = "custom" as const;
  renderingMode = "3d" as const;

  private map!: MlMap;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private originMc: maplibregl.MercatorCoordinate;
  private s: number; // mercator units per metre at origin
  private models = new Map<string, THREE.Group>();
  private beacons = new Map<string, THREE.Group>();
  private smoke = particles(SMOKE_PER_SOURCE * MAX_SOURCES, THREE.NormalBlending);
  private curtain = particles(CURTAIN_PER_AIRCRAFT * 8, THREE.NormalBlending);
  private embers = particles(SMOKE_PER_SOURCE * MAX_SOURCES / 2, THREE.AdditiveBlending);
  private sun = new THREE.DirectionalLight("#fff4e0", 2.2);
  private hemi = new THREE.HemisphereLight("#dfe9f5", "#5a4632", 1.1);
  private modelMatrix = new THREE.Matrix4();
  private elevCache = new Map<string, number>();
  frame: SceneFrame | null = null;
  onLabels: ((labels: ScreenLabel[]) => void) | null = null;
  private labelBuf: ScreenLabel[] = [];

  constructor(center: [number, number]) {
    this.originMc = maplibregl.MercatorCoordinate.fromLngLat(center, 0);
    this.s = this.originMc.meterInMercatorCoordinateUnits();
    this.modelMatrix
      .makeTranslation(this.originMc.x, this.originMc.y, 0)
      .scale(new THREE.Vector3(this.s, -this.s, this.s));
    this.scene.add(this.hemi, this.sun, this.smoke, this.embers, this.curtain);
    this.sun.position.set(0.4, -0.6, 1);
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
  }

  onRemove() {
    this.renderer?.dispose();
  }

  invalidateElevation() {
    this.elevCache.clear();
  }

  private ground(ll: [number, number]): number {
    const key = `${ll[0].toFixed(3)},${ll[1].toFixed(3)}`;
    let e = this.elevCache.get(key);
    if (e === undefined) {
      e = this.map.getTerrain() ? this.map.queryTerrainElevation(ll) ?? 0 : 0;
      if (this.elevCache.size > 5000) this.elevCache.clear();
      // only cache once tiles are in (a zero might be "not loaded yet")
      if (e !== 0) this.elevCache.set(key, e);
    }
    return e;
  }

  /** lon/lat + metres above sea level (already exaggerated ground) -> scene metres */
  private local(ll: [number, number], z: number): THREE.Vector3 {
    const mc = maplibregl.MercatorCoordinate.fromLngLat(ll, 0);
    return new THREE.Vector3((mc.x - this.originMc.x) / this.s, -(mc.y - this.originMc.y) / this.s, z);
  }

  private metresPerPixel(): number {
    const lat = this.map.getCenter().lat;
    return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** this.map.getZoom());
  }

  setSun(azimuth: number, altitude: number, night: number) {
    const az = (azimuth * Math.PI) / 180;
    const alt = (Math.max(altitude, 5) * Math.PI) / 180;
    this.sun.position.set(Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt));
    this.sun.intensity = 0.4 + 1.8 * (1 - night);
    this.hemi.intensity = 0.5 + 0.7 * (1 - night);
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const f = this.frame;
    if (!f || !this.renderer) return;
    // mainMatrix maps mercator coordinates (0..1, z in mercator units) to clip space in MapLibre 5;
    // modelViewProjectionMatrix expects world-pixel units instead.
    const mvp = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]);
    const full = mvp.multiply(this.modelMatrix);
    this.camera.projectionMatrix = full;
    this.camera.projectionMatrixInverse.copy(full).invert();

    const mpp = this.metresPerPixel();
    const exag = this.map.getTerrain()?.exaggeration ?? 1;
    const seen = new Set<string>();
    this.labelBuf.length = 0;

    // aircraft & drones
    for (const o of f.objects) {
      seen.add(o.id);
      let m = this.models.get(o.id);
      if (!m) {
        m = buildModel(o.kind, o.color);
        this.models.set(o.id, m);
        this.scene.add(m);
      }
      const size = (o.selected ? 34 : 24) * mpp * (o.kind === "quad" || o.kind === "hexa" ? 0.85 : 1);
      const z = this.ground(o.lnglat) + o.altAgl * Math.max(1, exag * 0.8);
      const p = this.local(o.lnglat, z);
      m.position.copy(p);
      m.scale.setScalar(size);
      m.rotation.set(0, 0, (-o.heading * Math.PI) / 180);
      m.visible = true;
      this.pushLabel(o.id, full, p);
    }
    for (const [id, m] of this.models) if (!seen.has(id)) m.visible = false;

    // hot-spot beacons: glowing columns scaled by fire power
    const bseen = new Set<string>();
    for (const b of f.beacons) {
      bseen.add(b.id);
      let g = this.beacons.get(b.id);
      if (!g) {
        g = new THREE.Group();
        const col = new THREE.Mesh(
          new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, true),
          new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
        );
        col.rotation.x = Math.PI / 2;
        col.position.z = 0.5;
        g.add(col);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.8, 1, 32),
          new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
        );
        ring.name = "ring";
        g.add(ring);
        this.beacons.set(b.id, g);
        this.scene.add(g);
      }
      const z = this.ground(b.lnglat);
      const p = this.local(b.lnglat, z + 2);
      g.position.copy(p);
      const w = (b.selected ? 5 : 3) * mpp;
      const h = (26 + 70 * b.strength) * mpp * (b.selected ? 1.4 : 1);
      const col = g.children[0] as THREE.Mesh;
      col.scale.set(w, h, w); // cylinder axis is local Y, rotated to point up
      col.position.z = h / 2;
      const ring = g.getObjectByName("ring") as THREE.Mesh;
      const pulse = 1 + 0.35 * Math.sin(f.time / 900 + hash(b.id.length) * 6);
      ring.scale.setScalar(w * 3.2 * pulse);
      g.visible = true;
      if (b.label) this.pushLabel(b.id, full, new THREE.Vector3(p.x, p.y, p.z + h));
    }
    for (const [id, g] of this.beacons) if (!bseen.has(id)) g.visible = false;

    // smoke plumes drift downwind and rise; deterministic in time so scrubbing is stable
    const pos = this.smoke.geometry.getAttribute("position") as THREE.BufferAttribute;
    const size = this.smoke.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const alpha = this.smoke.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const color = this.smoke.geometry.getAttribute("aColor") as THREE.BufferAttribute;
    const epos = this.embers.geometry.getAttribute("position") as THREE.BufferAttribute;
    const esize = this.embers.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const ealpha = this.embers.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const ecolor = this.embers.geometry.getAttribute("aColor") as THREE.BufferAttribute;
    const wa = (f.windToward * Math.PI) / 180;
    const wx = Math.sin(wa);
    const wy = Math.cos(wa);
    const drift = 4 + f.windKmh * 0.9; // m/s-ish visual drift
    const life = 1500; // s of simulated plume
    const n = SMOKE_PER_SOURCE;
    const sources = f.smoke.slice(0, MAX_SOURCES);
    let k = 0;
    let ek = 0;
    const night = f.night;
    for (let si = 0; si < MAX_SOURCES; si++) {
      const src = sources[si];
      const base = src ? this.local(src.lnglat, this.ground(src.lnglat)) : null;
      for (let j = 0; j < n; j++, k++) {
        if (!src || !base || f.smokeOpacity <= 0) {
          alpha.setX(k, 0);
          continue;
        }
        const ph = hash(si * 1000 + j);
        const age = ((f.time / 3 + ph * life) % life) / life; // 0..1
        const rise = 2600 * Math.sqrt(age) * (0.5 + src.strength);
        const along = drift * age * life * 0.9;
        const spread = 60 + 1400 * age;
        const ox = (hash(j * 3.1 + si) - 0.5) * spread;
        const oy = (hash(j * 7.7 + si) - 0.5) * spread;
        pos.setXYZ(k, base.x + wx * along + ox, base.y + wy * along + oy, base.z + rise * Math.min(1.6, exag));
        size.setX(k, 350 + 3400 * age * (0.6 + src.strength));
        const a = f.smokeOpacity * 0.62 * Math.sin(Math.PI * Math.min(1, age * 1.1)) * (0.45 + 0.55 * src.strength);
        alpha.setX(k, a);
        const shade = night ? 0.18 + 0.15 * (1 - age) : 0.58 + 0.25 * age;
        // near the base, smoke is lit by the fire from below (stronger at night)
        const fireLit = Math.max(0, 1 - age * 4) * (0.35 + 0.65 * night);
        color.setXYZ(k, shade + fireLit * 0.7, shade * 0.95 + fireLit * 0.25, shade * 0.9);
        if (j % 2 === 0 && ek < epos.count) {
          const eAge = ((f.time / 1.3 + ph * 300) % 300) / 300;
          epos.setXYZ(ek, base.x + (hash(j + 5) - 0.5) * 500 + wx * eAge * 300, base.y + (hash(j + 9) - 0.5) * 500 + wy * eAge * 300, base.z + 30 + eAge * 700);
          esize.setX(ek, 25 + 30 * (1 - eAge));
          ealpha.setX(ek, (1 - eAge) * (0.4 + 0.6 * night) * src.strength * f.smokeOpacity);
          ecolor.setXYZ(ek, 1, 0.55 + 0.3 * (1 - eAge), 0.15);
          ek++;
        }
      }
    }
    for (; ek < epos.count; ek++) ealpha.setX(ek, 0);
    for (const a of [pos, size, alpha, color, epos, esize, ealpha, ecolor]) a.needsUpdate = true;

    // retardant / water curtains behind dropping aircraft
    const cpos = this.curtain.geometry.getAttribute("position") as THREE.BufferAttribute;
    const csize = this.curtain.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const calpha = this.curtain.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const ccolor = this.curtain.geometry.getAttribute("aColor") as THREE.BufferAttribute;
    let ck = 0;
    for (const o of f.objects) {
      if (!o.dropping || ck >= cpos.count) continue;
      const m = this.models.get(o.id)!;
      const ha = (o.heading * Math.PI) / 180;
      const back = [-Math.sin(ha), -Math.cos(ha)];
      const isRet = o.dropping === "retardant";
      for (let j = 0; j < CURTAIN_PER_AIRCRAFT && ck < cpos.count; j++, ck++) {
        const u = hash(j * 13.3 + o.id.length);
        const d = u * 260;
        const fall = Math.min(1, u * 1.4) * (m.position.z - this.ground(o.lnglat));
        cpos.setXYZ(ck, m.position.x + back[0] * d + (hash(j) - 0.5) * 30, m.position.y + back[1] * d + (hash(j + 1) - 0.5) * 30, m.position.z - fall);
        csize.setX(ck, 35 + 70 * u);
        calpha.setX(ck, 0.55 * (1 - u * 0.6));
        if (isRet) ccolor.setXYZ(ck, 0.86, 0.18, 0.15);
        else ccolor.setXYZ(ck, 0.75, 0.88, 1.0);
      }
    }
    for (; ck < cpos.count; ck++) calpha.setX(ck, 0);
    for (const a of [cpos, csize, calpha, ccolor]) a.needsUpdate = true;

    // Point sizes: clip w is the view depth in world (CSS) pixels, so a particle of S metres spans
    // S * (mercator units per metre * world px per mercator unit) * focal / w device pixels.
    const worldSize = 512 * 2 ** this.map.getZoom();
    const focal = gl.drawingBufferHeight / 2 / Math.tan((args.fov || 0.6435) / 2);
    for (const pts of [this.smoke, this.embers, this.curtain]) {
      const um = (pts.material as THREE.ShaderMaterial).uniforms;
      um.uPxPerM.value = this.s * worldSize;
      um.uFocal.value = focal;
    }

    // ground labels (units on the ground, ICP...)
    for (const gl2 of f.groundLabels) {
      const p = this.local(gl2.lnglat, this.ground(gl2.lnglat) + 10);
      this.pushLabel(gl2.id, full, p);
    }

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.onLabels?.(this.labelBuf);
  }

  private pushLabel(id: string, m: THREE.Matrix4, p: THREE.Vector3) {
    const v = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(m);
    if (v.w <= 0) {
      this.labelBuf.push({ id, x: 0, y: 0, visible: false });
      return;
    }
    const cv = this.map.getCanvas();
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    const x = ((v.x / v.w + 1) / 2) * w;
    const y = ((1 - v.y / v.w) / 2) * h;
    this.labelBuf.push({ id, x, y, visible: x > -50 && x < w + 50 && y > -50 && y < h + 50 && v.z / v.w < 1 });
  }
}
