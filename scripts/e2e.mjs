// Interaction test: drives every control of the app in headless Chromium and fails on any page
// error, missing element or control without effect.
//
//   npm run build && npx vite preview --port 4173 &
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/e2e.mjs [http://127.0.0.1:4173/] [out-dir]

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("playwright is not installed: npm i --no-save playwright && npx playwright install chromium");
  process.exit(2);
}
const base = process.argv[2] ?? "http://127.0.0.1:4173/";
const out = process.argv[3] ?? "screenshots";
const fs = await import("node:fs");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errors = [];
const results = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to (load|fetch)|AJAXError|ERR_|CORS|eonet|firms/i.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
});

const st = (expr) => page.evaluate(expr);
const store = () => page.evaluate(() => window.__store.getState() && JSON.parse(JSON.stringify((({ time, mode, playing, lang, theme, units, tz, compare, tour, panel, selectedDrone, cameraOpen, follow, selectedUnit, selectedHotspot, view3d, incidentId, layers }) => ({ time, mode, playing, lang, theme, units, tz, compare, tour, panel, selectedDrone, cameraOpen, follow, selectedUnit, selectedHotspot, view3d, incidentId, layers }))(window.__store.getState()))));
async function check(name, fn) {
  const n0 = errors.length;
  try {
    const r = await fn();
    if (r === false) throw new Error("assertion failed");
    results.push(`ok    ${name}`);
  } catch (e) {
    results.push(`FAIL  ${name}: ${e.message.split("\n")[0]}`);
  }
  if (errors.length > n0) results.push(`      errors during ${name}: ${errors.slice(n0).join(" | ")}`);
}
const ready = () => page.waitForFunction(() => window.__map && window.__map.getLayer("fire") && window.__store && window.__store.getState().loading == null, null, { timeout: 60000 });

await page.goto(`${base}?incident=park-2024`, { waitUntil: "domcontentloaded" });
await ready();
await page.waitForTimeout(2500);

await check("default opens on the peak-power overpass", async () => {
  const s = await store();
  const peak = await st(() => window.__store.getState().bundle.meta.events.find((e) => e.kind === "frp").t);
  return s.incidentId === "park-2024" && s.mode === "incident" && Math.abs(s.time - peak) < 3600;
});

await check("play advances time, pause stops it", async () => {
  const t0 = (await store()).time;
  await page.keyboard.press(" ");
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0;
    const s = performance.now();
    const f = () => (performance.now() - s < 2000 ? (n++, requestAnimationFrame(f)) : res(n / 2));
    requestAnimationFrame(f);
  }));
  await page.keyboard.press(" ");
  const s = await store();
  results.push(`      playback ≈ ${fps.toFixed(0)} fps in software WebGL`);
  return !s.playing && s.time > t0 + 3600;
});

await check("keyboard: arrows, passes, events, modes", async () => {
  const t0 = (await store()).time;
  await page.keyboard.press("ArrowRight");
  const t1 = (await store()).time;
  await page.keyboard.press("Shift+ArrowLeft");
  const t2 = (await store()).time;
  await page.keyboard.press(".");
  const t3 = (await store()).time;
  await page.keyboard.press("2");
  const m2 = (await store()).mode;
  await page.keyboard.press("3");
  const m3 = (await store()).mode;
  await page.keyboard.press("1");
  return Math.round(t1 - t0) === 3600 && Math.round(t1 - t2) === 86400 && t3 > t2 && m2 === "drones" && m3 === "resources";
});

await check("timeline drag seeks", async () => {
  const box = await page.locator(".track").boundingBox();
  await page.mouse.click(box.x + box.width * 0.1, box.y + 20);
  const a = (await store()).time;
  await page.mouse.click(box.x + box.width * 0.6, box.y + 20);
  const b = (await store()).time;
  return b - a > 86400 * 5;
});

await check("prev/next event buttons", async () => {
  const t0 = (await store()).time;
  await page.click('button[aria-label="Previous event"]');
  const t1 = (await store()).time;
  await page.click('button[aria-label="Next event"]');
  const t2 = (await store()).time;
  return t1 < t0 && t2 > t1;
});

await check("speed selector", async () => {
  await page.selectOption(".tl-ctrl select", "12");
  return (await store()).playing === false && (await st(() => window.__store.getState().speed)) === 12;
});

await check("key event click jumps time and camera", async () => {
  // the fly-to animation itself is MapLibre's; assert the app requested it and moved the clock
  const cam0 = await st(() => window.__store.getState().camera?.id ?? null);
  const evT = await st(() => window.__store.getState().bundle.meta.events[3].t);
  await page.click(".events-list .ev >> nth=3");
  await page.waitForTimeout(500);
  const cam1 = await st(() => window.__store.getState().camera);
  const s = await store();
  return cam1 && cam1.id !== cam0 && Array.isArray(cam1.center) && Math.abs(s.time - evT) < 5;
});

await check("event search filters the list", async () => {
  const n0 = await page.locator(".events-list .ev").count();
  await page.fill(".events-h input", "night");
  const n1 = await page.locator(".events-list .ev").count();
  await page.fill(".events-h input", "");
  return n1 > 0 && n1 < n0;
});

await check("chart click seeks", async () => {
  const box = await page.locator(".chart-body >> nth=0").boundingBox();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 4 });
  await page.waitForTimeout(200);
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
  const s = await store();
  return s.time > Date.parse("2024-08-05T00:00:00Z") / 1000;
});

await check("every layer toggles and the map follows", async () => {
  const boxes = page.locator(".layer input[type=checkbox]");
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    await boxes.nth(i).click();
    await page.waitForTimeout(80);
    await boxes.nth(i).click();
  }
  await page.locator(".layer", { hasText: "Daily perimeters" }).locator("input[type=checkbox]").check();
  await page.waitForTimeout(300);
  const vis = await st(() => window.__map.getLayoutProperty("perimeters", "visibility"));
  await page.locator(".layer", { hasText: "Daily perimeters" }).locator("input[type=checkbox]").uncheck();
  const vis2 = await st(() => window.__map.getLayoutProperty("perimeters", "visibility"));
  return n >= 14 && vis === "visible" && vis2 === "none";
});

await check("opacity slider", async () => {
  await page.locator(".layer", { hasText: "Burned area" }).locator("input[type=range]").fill("0.4");
  return (await store()).layers.burned.opacity === 0.4;
});

await check("2D / 3D toggle", async () => {
  await page.click(".hud.br button:has-text('2D')");
  await page.waitForTimeout(900);
  const terr2d = await st(() => !!window.__map.getTerrain());
  await page.click(".hud.br button:has-text('3D')");
  await page.waitForTimeout(900);
  const terr3d = await st(() => !!window.__map.getTerrain());
  return !terr2d && terr3d;
});

await check("View menu: exaggeration, units, time zone, theme", async () => {
  await page.click(".tb-btn:has-text('View')");
  await page.click(".menu .mi:has-text('×2.5')");
  const ex = await st(() => window.__map.getTerrain()?.exaggeration);
  await page.click(".tb-btn:has-text('View')");
  await page.click(".menu .mi:has-text('Imperial')");
  await page.click(".menu .mi:has-text('UTC')");
  await page.click(".menu .mi:has-text('Dark')");
  await page.keyboard.press("Escape");
  const s = await store();
  const theme = await st(() => document.documentElement.dataset.theme);
  const tz = await page.locator(".tl-head span").first().textContent();
  return ex === 2.5 && s.units === "imperial" && s.tz === "utc" && theme === "dark" && /UTC/.test(tz);
});
await page.screenshot({ path: `${out}/dark-imperial.png` });

await check("Analysis menu: compare slider, progression, severity, perimeters", async () => {
  await page.click(".tb-btn:has-text('Analysis')");
  await page.click(".menu .mi:has-text('Before / after')");
  await page.locator(".compare-bar input").fill("0.8");
  const op = await st(() => window.__map.getPaintProperty("s2post", "raster-opacity"));
  await page.click(".compare-bar button");
  for (const name of ["Arrival-time map", "Burn severity", "Daily perimeters"]) {
    await page.click(".tb-btn:has-text('Analysis')");
    await page.click(`.menu .mi:has-text('${name}')`);
  }
  const s = await store();
  return op === 0.8 && s.compare == null && s.layers.progression.on && s.layers.severity.on && s.layers.perimeters.on && (await page.locator(".legend").count()) === 1;
});
await page.screenshot({ path: `${out}/analysis.png` });

await check("hover readout", async () => {
  const box = await page.locator(".map").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  return (await page.locator(".hover-tip").count()) === 1;
});

await check("drone mode: select, camera palettes, zoom, full view, follow", async () => {
  await page.click(".modes button:has-text('Drones')");
  await page.click(".right .row >> nth=2");
  await page.waitForTimeout(800);
  for (const p of ["EO", "WH", "BH", "IR"]) await page.click(`.cam .seg button:has-text('${p}')`);
  await page.click(".cam .seg button:has-text('4×')");
  await page.click('button[aria-label="Toggle full view"]');
  await page.waitForTimeout(500);
  const full = await page.locator(".cam.full").count();
  await page.click('button[aria-label="Toggle full view"]');
  await page.click(".btn:has-text('Follow')");
  const f = (await store()).follow;
  await page.click(".btn:has-text('Following')");
  const canvasHasPixels = await page.evaluate(() => {
    const c = document.querySelector(".cam canvas");
    const d = c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1).data;
    return d[3] === 255;
  });
  return full === 1 && f === "UAV-03" && canvasHasPixels;
});
await page.screenshot({ path: `${out}/drones.png` });

await check("hot spot list flies to the hot spot", async () => {
  const n = await page.locator(".right .card:has-text('Tracked hot spots') .row").count();
  if (!n) return true; // none active at this instant
  await page.click(".right .card:has-text('Tracked hot spots') .row >> nth=0");
  return !!(await store()).selectedHotspot;
});

await check("resources mode: unit card, chase, ride along, overview", async () => {
  await page.click(".modes button:has-text('Resources')");
  await page.click(".right .row:has-text('T-131')");
  await page.click(".btn:has-text('Chase')");
  const f1 = (await store()).follow;
  await page.click(".right .row:has-text('E-31')");
  await page.click(".btn:has-text('Ride along')");
  const f2 = (await store()).follow;
  await page.click(".btn:has-text('Overview')");
  const f3 = (await store()).follow;
  return f1 === "T-131" && f2 === "E-31" && f3 === null;
});
await page.screenshot({ path: `${out}/resources.png` });

await check("chart CSV download", async () => {
  const dl = page.waitForEvent("download", { timeout: 5000 });
  await page.click(".chart .menu-btn >> nth=0");
  await page.click(".menu .mi:has-text('CSV')");
  const d = await dl;
  return /\.csv$/.test(d.suggestedFilename());
});

await check("share copies a deep link that restores the view", async () => {
  await page.click(".modes button:has-text('Drones')");
  await page.click(".tb-btn:has-text('Share')");
  await page.waitForTimeout(300);
  const url = await page.evaluate(() => navigator.clipboard.readText());
  const s0 = await store();
  const p2 = await ctx.newPage();
  await p2.goto(url, { waitUntil: "domcontentloaded" });
  await p2.waitForFunction(() => window.__store && window.__store.getState().bundle && window.__store.getState().loading == null, null, { timeout: 60000 });
  const s1 = await p2.evaluate(() => window.__store.getState());
  await p2.close();
  return url.includes("mode=drones") && s1.mode === "drones" && Math.abs(s1.time - s0.time) < 61 && s1.units === "imperial" && s1.theme === "dark";
});

await check("language switch (PT, ES)", async () => {
  await page.selectOption(".tb-right select", "pt");
  const pt = await page.locator(".modes").textContent();
  await page.selectOption(".tb-right select", "es");
  const es = await page.locator(".modes").textContent();
  await page.selectOption(".tb-right select", "en");
  return /Recursos/.test(pt) && /Incidente/.test(es);
});

await check("About / Methods modal", async () => {
  await page.click('button[aria-label="About"]');
  const txt = await page.locator(".modal").textContent();
  await page.screenshot({ path: `${out}/about.png` });
  await page.keyboard.press("Escape");
  return /dNBR/.test(txt) && /EFIRE/.test(txt) && (await page.locator(".modal").count()) === 0;
});

await check("Live FIRMS modal opens and degrades gracefully offline", async () => {
  await page.click(".tb-btn:has-text('Analysis')");
  await page.click(".menu .mi:has-text('Live FIRMS')");
  await page.waitForTimeout(2500);
  const ok = (await page.locator(".modal input").count()) === 1;
  await page.keyboard.press("Escape");
  return ok;
});

await check("tour runs through every chapter", async () => {
  await page.click(".btn.primary:has-text('Tour')");
  let n = 0;
  while ((await page.locator(".tour-card").count()) && n < 20) {
    await page.waitForTimeout(700);
    if (n === 5) await page.screenshot({ path: `${out}/tour.png` });
    await page.click(".tour-card .btn.primary");
    n++;
  }
  return n >= 8 && (await store()).tour === null;
});

await check("incident picker switches incidents", async () => {
  await page.click(".tb-incident");
  await page.screenshot({ path: `${out}/incidents.png` });
  await page.click(".inc-card:has-text('Palisades')");
  await ready();
  const a = (await store()).incidentId;
  await page.click(".tb-incident");
  await page.click(".inc-card:has-text('Pantanal')");
  await ready();
  const b = (await store()).incidentId;
  await page.waitForTimeout(1500);
  return a === "palisades-2025" && b === "pantanal-2024";
});

// mobile
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
m.on("pageerror", (e) => errors.push(`mobile pageerror: ${e.message}`));
await m.goto(`${base}?incident=palisades-2025`, { waitUntil: "domcontentloaded" });
await m.waitForFunction(() => window.__map && window.__map.getLayer("fire"), null, { timeout: 60000 });
await check("mobile: everything fits, drawer opens", async () => {
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const offscreen = await m.evaluate(() => [...document.querySelectorAll(".topbar button, .topbar select")].filter((e) => {
    const r = e.getBoundingClientRect();
    return getComputedStyle(e).display !== "none" && r.width > 0 && r.right > window.innerWidth + 1;
  }).map((e) => e.textContent || e.getAttribute("aria-label")));
  await m.click('button[aria-label="Panel"]');
  await m.waitForTimeout(500);
  const open = await m.locator(".right.open").count();
  await m.screenshot({ path: `${out}/mobile-drawer.png` });
  if (offscreen.length) throw new Error(`off-screen: ${offscreen.join(", ")}`);
  return !overflow && open === 1;
});

console.log(results.join("\n"));
console.log(errors.length ? `\n${errors.length} page errors:\n${errors.join("\n")}` : "\nno page errors");
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) || errors.length ? 1 : 0);
