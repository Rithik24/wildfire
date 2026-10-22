# Emberline: wildfire intelligence on a 3D map

🌐 **Live:** https://rithik24.github.io/wildfire/ · runs entirely in your browser

**Watch a wildfire grow hour by hour, track its hot spots with a drone fleet and rehearse the firefighting response, all rebuilt from open satellite data.**

![Park Fire, night of 25–26 July 2024: the front running north on 3D terrain, smoke drifting with the observed wind](docs/img/hero.jpg)

Emberline replays real wildfires. Every flame, hot spot and burn scar on the map comes from NASA/NOAA satellites and the Copernicus programme. Each number shows where it came from:

| Chip | Meaning |
|---|---|
| `REAL` | measured by a satellite or weather station |
| `DERIVED` | computed here from those measurements |
| `REPORTED` | published by an agency or the press, with a link |
| `EXTERNAL` | third-party map layer |
| `SIM` | simulated rehearsal (drones, aircraft, crews) |

It runs as a static site with no server, account or API key.

## Incidents

**Burning now.** Every 3 hours a GitHub Actions job scans **every VIIRS fire pixel on Earth** from the last 8 days: about 24,000 granules and 1.3 million fire pixels. It groups them into fire complexes and ranks them by size, compactness and recent activity. The 10 most significant (at most 2 per country, 350 km apart) are then rebuilt as full incidents, each with:
- the hour-by-hour progression;
- tracked hot spots;
- the latest Sentinel-2 image;
- model weather from Open-Meteo.

They open at the latest satellite pass and carry a `LIVE` tag. A world map in the incident picker shows every fire burning in the last 48 h.

**Archive.** Ten major fires of 2024–2025, rebuilt from VIIRS and refined with the Sentinel-2 burn scar:

| Fire | Where | When | VIIRS pixels / overpasses | Burned area (derived) | Reported | Δ |
|---|---|---|---|---|---|---|
| **Park Fire** (default) | Butte & Tehama, California | Jul–Aug 2024 | 23,026 / 150 | 422,829 ac | 429,603 ac | −1.6 % |
| Smokehouse Creek | Texas Panhandle & Oklahoma | Feb–Mar 2024 | 4,719 / 20 | 1,137,771 ac | 1,058,482 ac | +7.5 % |
| Jasper Wildfire | Jasper NP, Alberta | Jul–Aug 2024 | 4,023 / 42 | 84,770 ac | 80,858 ac | +4.8 % |
| Palisades Fire | Los Angeles, California | Jan 2025 | 3,655 / 41 | 24,990 ac | 23,448 ac | +6.6 % |
| Eaton Fire | Altadena & Pasadena, California | Jan 2025 | 1,608 / 29 | 14,800 ac | 14,021 ac | +5.6 % |
| Larouco Fire | Ourense, Galicia, Spain | Aug 2025 | 5,931 / 84 | 41,247 ha | 31,778 ha¹ | +30 % |
| Ōfunato Wildfire | Iwate, Japan | Feb–Mar 2025 | 250 / 28 | 2,222 ha | 2,900 ha | −23 % |
| Uiseong–Andong | North Gyeongsang, South Korea | Mar 2025 | 7,619 / 45 | 102,842 ha | — | |
| Attica (Varnavas) | East Attica, Greece | Aug 2024 | 1,270 / 15 | 11,214 ha | — | |
| Pantanal · Corumbá | Mato Grosso do Sul, Brazil | Jun 2024 | 32,826 / 202 | 243,258 ha in a 1° window | no official perimeter | |

¹ Galician territory only; the fire also burned across the border into Portugal and merged with neighbouring fires. Ōfunato is small, with many pixels under cloud, and VIIRS sees too little of it.

<table><tr>
<td><img src="docs/img/drones.jpg" alt="Drones mode: the fleet orbiting tracked hot spots and the thermal camera view"></td>
<td><img src="docs/img/resources.jpg" alt="Resources mode: air tankers, engines and crews working the fire"></td>
</tr><tr>
<td><b>Drones.</b> Six simulated UAVs are tasked at every satellite overpass to the hot spots VIIRS is tracking. The camera renders the real arrival-time and severity data as a thermal (Ironbow / White-hot / Black-hot) or EO image, with a HUD.</td>
<td><b>Resources.</b> Air tankers fly drop cycles in daylight from the real air base to the active front. Retardant and water lines stay on the ground. Crews and dozers build line from the heel of the fire. Containment follows reported values where they exist.</td>
</tr><tr>
<td><img src="docs/img/pantanal.jpg" alt="Pantanal fires near Corumbá with daily perimeters"></td>
<td><img src="docs/img/severity.jpg" alt="Palisades Fire burn severity from Sentinel-2 dNBR"></td>
</tr><tr>
<td><b>Pantanal, Brazil.</b> A month of wetland fires around Corumbá, with daily perimeters and hot spots.</td>
<td><b>Burn severity.</b> Sentinel-2 dNBR at 20 m for the Palisades Fire, shown on each pixel once it has burned on the timeline.</td>
</tr></table>

## What you can do

- **Scrub through time.** One timeline drives the map, charts, panels and camera. Nights are shaded and every satellite pass is marked. Use play at 30 min/s to 24 h/s, step event by event (`[` `]`) or pass by pass (`,` `.`).
- **Read the fire.** Layers:
  - The active front: everything that ignited in the last 12 h, glowing at the leading edge.
  - Char.
  - Individual 375 m VIIRS pixels, aged by colour.
  - Tracked hot-spot beacons.
  - Daily perimeters.
  - An arrival-time map (the classic progression map).
  - Burn severity.
  - Sentinel-2 before and after, with a slider.
  - Smoke that leans with the hourly observed wind.
  - Terrain lit by the real sun, darkening at night.
- **Hover the terrain** for elevation, the time each place burned, and its severity.
- **Charts** for burned area, expansion rate and fire radiative power per pass (Incident mode); active hot spots, strongest hot spot and drone battery (Drones mode); drops, fire line and personnel (Resources mode). Click a chart to jump to that moment, or download any chart as CSV.
- **Key events** are computed from the data:
  - first detection
  - peak fire power
  - fastest growth
  - night-time runs
  - area milestones
  - growth slowing
  - airport METARs mentioning the fire or smoke
  - reported facts with sources

  Hot-spot alerts and the Air Ops log have their own lists. Click any event to fly there.
- **Tour.** A guided story of each incident, from first detection through the run, peak power, drones, response, severity and before/after.
- **Live FIRMS.** Overlay near-real-time NASA FIRMS detections on the current view with your free MAP_KEY. Jump to open wildfires from NASA EONET.
- **Share.** Copy a link that opens the same instant, mode, selection, layers and camera.
- English, Português and Español; metric or imperial units; local time or UTC; light or dark theme. Works on phones.

Keyboard: `Space` play/pause · `←`/`→` one hour (`Shift`: one day) · `[`/`]` events · `,`/`.` passes · `1`/`2`/`3` modes · `R` reset view · `Esc` close.

## How it works

```
 OFFLINE or every 3 h in CI (Python, pipeline/)                    STATIC SITE (public/ + src/)
 NOAA EFIRE VIIRS 375 m (S-NPP, NOAA-20, NOAA-21) ─┐                React 19 · TypeScript · Vite · Zustand
 Sentinel-2 L2A COGs (pre / post)                  ├─▶ data/<id>/   MapLibre GL 5: 3D terrain, imagery, fire raster
 NOAA ISD / Open-Meteo hourly weather              ┘   incident.json, arrival.png, three.js layer: aircraft, drones,
                                                       detections, hotspots, perimeters,  smoke, drop curtains, beacons
                                                       weather, s2_pre/post.jpg, severity Deterministic sims: drones, air ops
```

1. **When it burned** (`pipeline/fetch_viirs.py`). NOAA publishes the VIIRS I-band Enterprise Active Fire product (EFIRE) for all three VIIRS satellites on its open AWS buckets. For each day the fetcher:
   - lists the granules;
   - keeps those in the ~13:30 and ~01:30 local-solar overpass windows;
   - **range-reads only the first 32 KB** of each, which holds its footprint polygon;
   - downloads the few that cross the fire and extracts every fire pixel with its time, FRP and 4 µm brightness temperature.
2. **Where it burned** (`pipeline/sentinel2.py`). Pre- and post-fire Sentinel-2 L2A composites are built per pixel from the clearest scenes, read straight from COG overviews into a Web Mercator grid. The burn scar is dNBR = NBR<sub>pre</sub> − NBR<sub>post</sub> ≥ 0.1, kept within 1.5 km of VIIRS fire. Dry-season wetlands brown everywhere, so the Pantanal uses dNBR ≥ 0.27 and post-fire NBR ≤ 0.
3. **Arrival time** (`pipeline/build_incident.py`).
   - VIIRS footprints are painted on a 40–100 m grid and closed morphologically after every overpass.
   - New cells get a time between the previous look and the current one, in proportion to their distance from the previous burned area.
   - Burn-scar cells take the time of the nearest VIIRS cell.
   - The browser decodes the grid from a 16-bit PNG and paints any instant in one pass.
4. **Hot spots**. Each overpass's fire pixels are clustered (1.2 km) and linked across overpasses (4 km, 36 h) into tracks with a status: new, intensifying, steady or cooling.
5. **Weather** (`pipeline/weather.py`). Hourly wind, gusts, temperature and humidity come from the nearest airport in NOAA's ISD. METAR remarks such as `PACIFIC PALISADES FIRE FU NW-SW` become events.
6. **Live discovery** (`pipeline/scan_global.py`, `pipeline/live.py`).
   - Every granule from the last 8 days is opened with HTTP range requests; only the fire-pixel arrays are read.
   - Pixels are binned at 0.02° and grouped into 8-connected complexes. These are ranked by area × fill × density × recent activity.
   - The top complexes are named from the Natural Earth gazetteer ("Fire near Birao", with distance and bearing).
   - Each gets a time zone, the nearest airport and a fleet, and goes through steps 1–4 with the latest Sentinel-2 view. Weather comes from Open-Meteo.
   - With no post-fire image yet, the footprint is VIIRS-only.
7. **Simulated response** (`src/sim/`). This part is pure functions of time, so scrubbing in either direction is exact:
   - Drones are tasked at each overpass to the live edge of the strongest hot spots.
   - Aircraft fly event-scheduled drop cycles in daylight.
   - Ground units ride the perimeter.
   - Containment is anchored to reported numbers where they exist.

The deriving and simulating steps are open, and the in-app *Methods & sources* panel shows each one for the incident you are looking at.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/ (relative paths: works on GitHub Pages, Vercel or any static host)
```

The incident packages are committed in `public/data/`, so the app needs nothing else. Basemap imagery (Esri) and terrain (AWS Terrain Tiles) load from public tile servers. If imagery is blocked, the bundled Sentinel-2 images still cover each fire.

**Deploy.**
- **GitHub Pages:** `.github/workflows/pages.yml` publishes `dist/` on every push to the repository's default branch and every 3 hours. Each run rescans the planet and rebuilds the "burning now" fires (about 15 minutes). Enable it under *Settings → Pages → Source: GitHub Actions*.
- **Vercel:** `vercel.json` is included.

## Rebuild the data, or add a fire

Python ≥ 3.11:

```bash
pip install -r pipeline/requirements.txt
WILDFIRE_RAW=/tmp/raw bash pipeline/run_all.sh     # ≈15 min, downloads ~2 GB, no accounts or keys
```

To add an incident, add an entry to `pipeline/incidents.py`:
- bbox
- UTC window
- time zone
- origin (optional)
- nearest ISD station
- Sentinel-2 before/after windows
- air base
- reported facts with sources

Then run the steps for it:

```bash
python -m pipeline.fetch_viirs <id>
python -m pipeline.build_incident <id> --res 80
python -m pipeline.sentinel2 <id>
python -m pipeline.build_incident <id> --res 80     # second pass: refine with the burn scar
python -m pipeline.weather <id>
python -m pipeline.make_index
```

EFIRE coverage on AWS starts in February 2024.

Live fires, the same way the scheduled job builds them (about 10 min with a fast connection):

```bash
python -m pipeline.scan_global --days 8 --out public/data/live   # every fire pixel on Earth → world.json
python -m pipeline.live --max 10                                 # builds public/data/live-*/
python -m pipeline.make_index                                    # --archive-only for the committed catalogue
```

## Tests

```bash
npm test                         # pipeline unit tests (pytest)
npm run typecheck
npm run build && npx vite preview --port 4173 &
npm i --no-save playwright && npx playwright install chromium
npm run smoke                    # opens every incident in Chromium, walks the 3 modes, checks layers and errors
npm run e2e                      # drives every control (28 checks): timeline, keyboard, layers, menus, camera,
                                 # share links, languages, tour, incident picker,
                                 # world map, live fires, mobile layout
```

CI (`.github/workflows/ci.yml`) runs the typecheck, the build and the pipeline tests on every push.

## Limits

- **This is an exploratory analysis and training tool**, not an operational fire-spread prediction or incident-management system.
- Up to six overpasses a day look at a fire. Timing between them is interpolated, and the first detection is not the ignition.
- VIIRS pixels are 375 m (larger at the edge of the swath), and very hot fires light up neighbouring pixels. That is why the final footprint comes from Sentinel-2 rather than VIIRS alone; VIIRS alone overestimates the Palisades Fire by about 80 %.
- Sentinel-2 composites can miss small areas under persistent cloud or smoke; VIIRS fills them.
- The weather is one airport station, which can be tens of kilometres from the fire. Live fires use Open-Meteo model weather (`EXTERNAL`), not observations.
- **Live fires have no burn scar yet**, so their footprint is VIIRS-only and runs large, like the 80 % above. Their names come from the nearest town in a gazetteer, not from an agency. A complex can be a fire, a cluster of agricultural burns, or a gas flare that survived the filters.
- The archive's derived areas sit within ±8 % of the official figures for the five US/Canada fires. Larouco is +30 % against the Galician-territory figure, and Ōfunato is −23 %.
- **Drones, aircraft, crews, drops, fire line, personnel and the thermal camera are simulated.** The thermal temperatures are illustrative. Containment is interpolated between reported values (Park, Palisades) or simulated (Pantanal).

## Credits and licences

**Code:** MIT ([LICENSE](LICENSE)).

**Data:**
- NOAA JPSS VIIRS Enterprise Active Fire (EFIRE), NOAA Open Data Dissemination: public domain.
- Contains modified Copernicus Sentinel data (2024–2025); Sentinel-2 L2A COGs by Element 84 on AWS.
- NOAA NCEI Integrated Surface Database: public domain.
- Weather for live fires: [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
- Gazetteer: Natural Earth populated places (public domain); time zones: timezonefinder.
- AWS Terrain Tiles (Mapzen terrarium; SRTM, USGS 3DEP and others).
- Basemap imagery and labels © Esri and its partners.
- Reported facts link to their sources in the app: CAL FIRE, InciWeb, NASA Earth Observatory, Xunta de Galicia, City of Malibu, CBC, Mongabay, NBC Los Angeles, LAist, Spectrum News, NSPR, Firehouse, Al Jazeera, Anadolu, Euronews, Ta Nea, The Objective, Wikipedia.
