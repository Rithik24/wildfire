// End-to-end smoke test: opens every incident in headless Chromium, walks the three modes,
// opens the drone camera and checks that the map layers exist and nothing throws.
//
//   npm run build && npx vite preview --port 4173 &
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/smoke.mjs [http://127.0.0.1:4173/] [out-dir]

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
const index = await (await fetch(new URL("data/index.json", base))).json();
let failures = 0;

for (const inc of index.incidents) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // third-party tile hosts may be unreachable in CI; everything else is an error
    if (m.type() === "error" && !/Failed to (load|fetch)|AJAXError|ERR_/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`${base}?incident=${inc.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__map && window.__map.getLayer("fire") && window.__map.getLayer("scene3d"), null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/${inc.id}-incident.png` });

  const checks = await page.evaluate(() => ({
    layers: ["fire", "detections", "perimeters", "drops", "containment", "scene3d"].filter((id) => !window.__map.getLayer(id)),
    events: document.querySelectorAll(".ev").length,
  }));
  if (checks.layers.length) errors.push(`missing layers: ${checks.layers.join(",")}`);
  if (!checks.events) errors.push("no key events listed");

  await page.keyboard.press("2");
  await page.click(".row >> nth=1");
  await page.waitForTimeout(2500);
  if (!(await page.$(".cam canvas"))) errors.push("drone camera did not open");
  await page.screenshot({ path: `${out}/${inc.id}-drones.png` });

  await page.keyboard.press("3");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/${inc.id}-resources.png` });

  await page.keyboard.press("1");
  await page.keyboard.press(" ");
  await page.waitForTimeout(1500);
  await page.keyboard.press(" ");

  console.log(`${errors.length ? "FAIL" : "ok  "} ${inc.id}${errors.length ? "\n  " + errors.join("\n  ") : ""}`);
  failures += errors.length ? 1 : 0;
  await page.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
