"""Incident definitions shared by every pipeline step.

Each incident is a bounding box, a UTC time window and the facts we could
verify from public reporting. Everything the pipeline derives (detections,
arrival times, perimeters, severity, weather) comes from open satellite and
station archives; nothing here is invented. Reported facts carry their source.
"""

INCIDENTS = {
    "park-2024": {
        "name": "Park Fire",
        "region": "Butte & Tehama Counties, California, USA",
        "country": "US",
        "bbox": [-122.20, 39.72, -121.40, 40.42],  # W, S, E, N
        "start": "2024-07-24T18:00:00Z",
        "end": "2024-08-20T00:00:00Z",
        "timezone": "America/Los_Angeles",
        "origin": [-121.776, 39.758],  # near Upper Bidwell Park, Chico
        "isd_station": "72497393203",  # Chico Municipal Airport (KCIC)
        "isd_fallback": ["72591024216", "74504893210"],
        "s2_pre": ["2024-07-10", "2024-07-24"],
        "s2_post": ["2024-08-25", "2024-09-20"],
        "base": {"name": "Chico Air Attack Base", "lonlat": [-121.858, 39.795]},
        "icp": {"name": "Staging area (sim)", "lonlat": [-121.80, 39.78]},
        "reported": {
            "final_acres": 429603,
            "structures_destroyed": 709,
            "contained": "2024-09-26",
            "cause": "Arson (suspect arrested)",
            "facts": [
                {"t": "2024-07-24T22:00:00Z", "text": "Fire reported near Upper Bidwell Park, Chico", "source": "CAL FIRE incident page"},
                {"t": "2024-08-19T15:00:00Z", "text": "429,263 acres, 49% contained", "acres": 429263, "containment": 49, "source": "North State Public Radio, 19 Aug 2024"},
            ],
            "sources": [
                {"label": "CAL FIRE · Park Fire", "url": "https://www.fire.ca.gov/incidents/2024/7/24/park-fire"},
                {"label": "InciWeb · CALNF Park Fire", "url": "https://inciweb.wildfire.gov/incident-information/calnf-park-fire"},
                {"label": "Wikipedia · Park Fire", "url": "https://en.wikipedia.org/wiki/Park_Fire"},
                {"label": "NSPR, 19 Aug 2024", "url": "https://www.mynspr.org/news/2024-08-19/update-growth-slows-on-the-park-fire-as-firefighters-increase-containment"},
            ],
        },
        "fleet": "us",
    },
    "pantanal-2024": {
        "name": "Pantanal Fires · Corumbá",
        "region": "Corumbá, Mato Grosso do Sul, Brazil",
        "country": "BR",
        "bbox": None,  # chosen from the densest cluster in search_bbox
        "search_bbox": [-58.10, -20.20, -56.20, -17.70],
        "bbox_size_deg": [1.0, 0.85],
        # Dry-season browning of the wetland lowers NBR everywhere: require a strong
        # drop and a char-like post-fire NBR, not just dNBR >= 0.1.
        "scar": {"dnbr_min": 0.27, "nbr_post_max": 0.0},
        "start": "2024-06-01T00:00:00Z",
        "end": "2024-07-01T00:00:00Z",
        "timezone": "America/Campo_Grande",
        "origin": None,
        "isd_station": "83552099999",  # Corumbá (SBCR)
        "isd_fallback": ["86767099999"],
        "s2_pre": ["2024-05-01", "2024-05-31"],
        "s2_post": ["2024-07-01", "2024-07-31"],
        "base": {"name": "Corumbá Airport (SBCR)", "lonlat": [-57.6714, -19.0119]},
        "icp": {"name": "Brigade base (sim)", "lonlat": [-57.65, -19.00]},
        "reported": {
            "facts": [
                {"t": "2024-06-11T12:00:00Z", "text": "INPE: 549 active fires in the Pantanal, the most for any June since 1998", "source": "NASA Earth Observatory"},
                {"t": "2024-06-23T12:00:00Z", "text": "LASA/UFRJ: >627,000 ha burned in the Pantanal in the first 23 days of June", "source": "Mongabay, June 2024"},
            ],
            "sources": [
                {"label": "NASA Earth Observatory · Early Fires in Brazil's Pantanal", "url": "https://earthobservatory.nasa.gov/images/152925/early-fires-in-brazils-pantanal"},
                {"label": "Mongabay · Pantanal's intense blazes", "url": "https://news.mongabay.com/2024/06/pantanals-intense-blazes-stoke-fears-of-another-destructive-fire-season/"},
                {"label": "Wikipedia · 2024 Brazil wildfires", "url": "https://en.wikipedia.org/wiki/2024_Brazil_wildfires"},
            ],
        },
        "fleet": "br",
    },
    "palisades-2025": {
        "name": "Palisades Fire",
        "region": "Pacific Palisades, Los Angeles, California, USA",
        "country": "US",
        "bbox": [-118.74, 34.00, -118.46, 34.16],
        "start": "2025-01-07T16:00:00Z",
        "end": "2025-01-20T00:00:00Z",
        "timezone": "America/Los_Angeles",
        "origin": [-118.548, 34.076],
        "isd_station": "72288593197",  # Santa Monica Municipal Airport (KSMO)
        "isd_fallback": ["72288623130", "72295023174"],
        "s2_pre": ["2024-12-20", "2025-01-06"],
        "s2_post": ["2025-01-20", "2025-02-10"],
        "base": {"name": "Van Nuys Airport", "lonlat": [-118.490, 34.210]},
        "icp": {"name": "Staging area (sim)", "lonlat": [-118.50, 34.03]},
        "reported": {
            "final_acres": 23448,
            "structures_destroyed": 6837,
            "fatalities": 12,
            "contained": "2025-01-31",
            "facts": [
                {"t": "2025-01-07T19:06:00Z", "text": "First report: 10 acres at 11:06 a.m.", "acres": 10, "source": "NBC Los Angeles timeline"},
                {"t": "2025-01-07T23:30:00Z", "text": "1,262 acres by about 3:30 p.m.", "acres": 1262, "source": "NBC Los Angeles timeline"},
                {"t": "2025-01-08T23:00:00Z", "text": "15,832 acres; ~300 structures destroyed reported so far", "acres": 15832, "source": "NBC Los Angeles timeline"},
                {"t": "2025-01-24T20:00:00Z", "text": "77% contained", "containment": 77, "source": "NBC Los Angeles timeline"},
            ],
            "sources": [
                {"label": "Wikipedia · Palisades Fire", "url": "https://en.wikipedia.org/wiki/Palisades_Fire"},
                {"label": "NBC Los Angeles · Timeline", "url": "https://www.nbclosangeles.com/news/california-wildfires/timeline-eaton-palisades-fires-la-county/3614940/"},
                {"label": "City of Malibu · Incident archive", "url": "https://www.malibucity.org/1168/Palisades-Fire-Incident-Information-Arch"},
            ],
        },
        "fleet": "us",
    },
    "eaton-2025": {
        "name": "Eaton Fire",
        "region": "Altadena & Pasadena, Los Angeles County, California, USA",
        "country": "US",
        "bbox": [-118.22, 34.14, -117.98, 34.28],
        "start": "2025-01-08T02:00:00Z",
        "end": "2025-01-20T00:00:00Z",
        "timezone": "America/Los_Angeles",
        "origin": [-118.115, 34.194],
        "isd_station": "72288023152",  # Burbank (KBUR)
        "isd_fallback": ["74704303165", "72287493134"],
        "s2_pre": ["2024-12-20", "2025-01-06"],
        "s2_post": ["2025-01-20", "2025-02-10"],
        "base": {"name": "Hollywood Burbank Airport", "lonlat": [-118.358, 34.201]},
        "icp": {"name": "Staging area (sim)", "lonlat": [-118.14, 34.16]},
        "reported": {
            "final_acres": 14021,
            "structures_destroyed": 9418,
            "fatalities": 17,
            "facts": [
                {"t": "2025-01-08T02:18:00Z", "text": "Fire reported at 6:18 p.m. near Altadena Dr. and Midwick Dr.", "source": "LAist"},
            ],
            "sources": [
                {"label": "LAist · Eaton Fire", "url": "https://laist.com/news/climate-environment/eaton-fire-altadena"},
                {"label": "Spectrum News · Eaton Fire", "url": "https://spectrumnews1.com/ca/la/wildfires/2025/01/08/eaton-fire-altadena"},
            ],
        },
        "fleet": "us",
    },
    "smokehouse-2024": {
        "name": "Smokehouse Creek Fire",
        "region": "Texas Panhandle & Oklahoma, USA",
        "country": "US",
        "bbox": [-101.62, 35.42, -99.85, 36.15],
        # grass fire: it outran the overpasses, so pixels are sparse; link them over 5 km to keep
        # the Smokehouse Creek run and drop the separate Windy Deuce Fire to the south-west
        "isolate": True,
        "isolate_link_m": 5000,
        "scar": {"dnbr_min": 0.1, "reach_m": 6000},
        "start": "2024-02-26T20:00:00Z",
        "end": "2024-03-06T00:00:00Z",
        "timezone": "America/Chicago",
        "origin": [-101.45, 35.83],
        "isd_station": "72363503024",  # Hutchinson County Airport (KBGD)
        "isd_fallback": ["72031303052", "72062600213"],
        "s2_pre": ["2024-01-10", "2024-02-25"],
        "s2_post": ["2024-03-06", "2024-03-25"],
        "base": {"name": "Rick Husband Amarillo Intl", "lonlat": [-101.706, 35.219]},
        "icp": {"name": "Staging area (sim)", "lonlat": [-101.39, 35.70]},
        "reported": {
            "final_acres": 1058482,
            "fatalities": 2,
            "contained": "2024-03-16",
            "cause": "Power lines (state investigators)",
            "facts": [
                {"t": "2024-02-26T20:20:00Z", "text": "Fire starts near Stinnett, Hutchinson County", "source": "Wikipedia"},
                {"t": "2024-03-01T18:00:00Z", "text": "1,078,086 acres: largest wildfire in Texas history", "acres": 1078086, "source": "Texas A&M Forest Service via FOX"},
            ],
            "sources": [
                {"label": "Wikipedia · Smokehouse Creek Fire", "url": "https://en.wikipedia.org/wiki/Smokehouse_Creek_Fire"},
                {"label": "Firehouse · Texas' largest wildfire contained", "url": "https://www.firehouse.com/operations-training/wildland/news/53099277/after-three-weeks-texas-largest-wildfire-contained"},
            ],
        },
        "fleet": "us",
    },
    "jasper-2024": {
        "name": "Jasper Wildfire",
        "region": "Jasper National Park, Alberta, Canada",
        "country": "CA",
        "bbox": None,
        "search_bbox": [-118.5, 52.3, -117.6, 53.1],
        "bbox_size_deg": [0.65, 0.5],
        "start": "2024-07-22T18:00:00Z",
        "end": "2024-08-12T00:00:00Z",
        "timezone": "America/Edmonton",
        "origin": None,
        "isd_station": "71486099999",  # Jasper Warden
        "isd_fallback": ["71252099999"],
        "s2_pre": ["2024-07-01", "2024-07-21"],
        "s2_post": ["2024-08-15", "2024-09-15"],
        "base": {"name": "Hinton/Jasper-Hinton Airport", "lonlat": [-117.753, 53.319]},
        "icp": {"name": "Staging area (sim)", "lonlat": [-118.08, 52.88]},
        "reported": {
            "final_acres": 80858,  # 32,722 ha when declared under control, 7 Sep 2024
            "structures_destroyed": 358,
            "facts": [
                {"t": "2024-07-25T04:00:00Z", "text": "Fire reaches the Jasper townsite on winds of up to 100 km/h", "source": "The Weather Network"},
                {"t": "2024-07-26T20:00:00Z", "text": "358 of the townsite's 1,113 structures destroyed; ~32,000 ha after aerial survey", "source": "Parks Canada via CBC"},
            ],
            "sources": [
                {"label": "Wikipedia · 2024 Jasper wildfire", "url": "https://en.wikipedia.org/wiki/2024_Jasper_wildfire"},
                {"label": "CBC · structures destroyed", "url": "https://www.cbc.ca/lite/story/1.7277680"},
            ],
        },
        "fleet": "us",
    },
    "uiseong-2025": {
        "name": "Uiseong–Andong Wildfire",
        "region": "North Gyeongsang, South Korea",
        "country": "KR",
        "bbox": None,
        "search_bbox": [128.4, 36.0, 129.7, 36.9],
        "bbox_size_deg": [1.25, 0.75],
        "start": "2025-03-22T01:00:00Z",
        "end": "2025-04-01T00:00:00Z",
        "timezone": "Asia/Seoul",
        "origin": [128.62, 36.38],
        "isd_station": "47136099999",  # Andong
        "isd_fallback": ["47134099999"],
        "s2_pre": ["2025-03-01", "2025-03-21"],
        "s2_post": ["2025-04-01", "2025-04-25"],
        "base": {"name": "Andong forest-fire helicopter base (approx.)", "lonlat": [128.73, 36.57]},
        "icp": {"name": "Staging area (sim)", "lonlat": [128.70, 36.35]},
        "reported": {
            "fatalities": 28,
            "facts": [
                {"t": "2025-03-22T02:30:00Z", "text": "Fire starts in Uiseong during an ancestral rite at a family grave (police)", "source": "Maitland Mercury / AAP"},
                {"t": "2025-03-27T09:00:00Z", "text": "Death toll rises to 28; over 38,000 ha of woodland burned nationwide", "source": "Anadolu Agency"},
            ],
            "sources": [
                {"label": "Al Jazeera · worst wildfires in South Korea's history", "url": "https://www.aljazeera.com/amp/news/2025/3/27/south-korea-says-wildfires-worst-in-its-history-death-toll-rises-to-26"},
                {"label": "Anadolu · death toll rises to 28", "url": "https://www.aa.com.tr/en/asia-pacific/death-toll-from-wildfires-in-south-korea-rises-to-28/3521111"},
            ],
        },
        "fleet": "intl",
    },
    "ofunato-2025": {
        "name": "Ōfunato Wildfire",
        "region": "Ōfunato, Iwate, Japan",
        "country": "JP",
        "bbox": [141.62, 38.99, 141.86, 39.13],
        "start": "2025-02-26T03:00:00Z",
        "end": "2025-03-10T00:00:00Z",
        "timezone": "Asia/Tokyo",
        "origin": None,
        "isd_station": "47512099999",  # Ofunato
        "isd_fallback": ["47585099999"],
        "s2_pre": ["2025-01-20", "2025-02-25"],
        "s2_post": ["2025-03-10", "2025-04-10"],
        "base": {"name": "Hanamaki Airport", "lonlat": [141.135, 39.428]},
        "icp": {"name": "Staging area (sim)", "lonlat": [141.72, 39.07]},
        "reported": {
            "final_acres": 7166,
            "structures_destroyed": 171,
            "fatalities": 1,
            "contained": "2025-03-09",
            "facts": [
                {"t": "2025-02-26T04:00:00Z", "text": "Fire ignites by 1 p.m. local time (FDMA)", "source": "NASA Earth Observatory"},
                {"t": "2025-02-28T06:00:00Z", "text": "About 1,200 ha: largest wildfire in Japan in three decades", "acres": 2965, "source": "Japan Times / AFP"},
            ],
            "sources": [
                {"label": "Wikipedia · Ōfunato wildfire", "url": "https://en.wikipedia.org/wiki/%C5%8Cfunato_wildfire"},
                {"label": "NASA Earth Observatory", "url": "https://science.nasa.gov/earth/earth-observatory/fire-grows-unusually-large-in-japan-154008"},
            ],
        },
        "fleet": "intl",
    },
    "larouco-2025": {
        "name": "Larouco Fire",
        "region": "Ourense & Lugo, Galicia, Spain",
        "country": "ES",
        "bbox": [-7.28, 42.27, -6.79, 42.61],
        "start": "2025-08-13T16:00:00Z",
        "end": "2025-08-27T00:00:00Z",
        "timezone": "Europe/Madrid",
        "origin": [-7.16, 42.35],  # Seadur parish, Larouco
        # other large fires burned in Ourense the same week: keep the one that started at the origin
        "isolate": True,
        "isd_station": "08048099999",  # Orense
        "isd_fallback": ["08053099999"],
        "s2_pre": ["2025-07-20", "2025-08-12"],
        "s2_post": ["2025-08-27", "2025-09-20"],
        "base": {"name": "Ourense air base (approx.)", "lonlat": [-7.86, 42.34]},
        "icp": {"name": "Staging area (sim)", "lonlat": [-7.16, 42.34]},
        "reported": {
            "final_acres": 78525,  # 31,778 ha in Galician territory (Xunta, at extinction)
            "facts": [
                {"t": "2025-08-13T16:55:00Z", "text": "Fire starts at 18:55 in the parish of Seadur, Larouco", "source": "Xunta de Galicia"},
                {"t": "2025-08-23T10:00:00Z", "text": "Declared stabilised at ~30,000 ha: the largest fire in Galicia's history", "source": "The Objective"},
            ],
            "sources": [
                {"label": "Xunta de Galicia · Larouco fire extinguished (31,778 ha)", "url": "https://www.xunta.gal/notas-de-prensa/-/nova/016163/medio-rural-informa-situacion-dos-lumes-forestais-con-datos-recollidos-ata-14"},
                {"label": "The Objective · Larouco stabilised", "url": "https://theobjective.com/actualidad/2025-08-23/estabilizado-incendio-larouco-mayor-galicia/"},
                {"label": "Euronews · Spain wildfires", "url": "https://www.euronews.com/2025/08/14/wildfires-destroy-thousands-of-hectares-in-spain"},
            ],
        },
        "fleet": "intl",
    },
    "attica-2024": {
        "name": "Attica Wildfire (Varnavas)",
        "region": "East Attica, Greece",
        "country": "GR",
        "bbox": [23.72, 37.98, 24.08, 38.30],
        "start": "2024-08-11T11:00:00Z",
        "end": "2024-08-17T00:00:00Z",
        "timezone": "Europe/Athens",
        "origin": [23.93, 38.22],
        "isd_station": "16715099999",  # Tatoi / Dekelia
        "isd_fallback": ["16716199999"],
        "s2_pre": ["2024-07-20", "2024-08-10"],
        "s2_post": ["2024-08-17", "2024-09-10"],
        "base": {"name": "Elefsina Air Base (Canadair)", "lonlat": [23.555, 38.065]},
        "icp": {"name": "Staging area (sim)", "lonlat": [23.95, 38.10]},
        "reported": {
            "facts": [
                {"t": "2024-08-11T12:00:00Z", "text": "Fire starts at about 3 p.m. near Varnavas, 35 km north of Athens", "source": "Wikipedia"},
                {"t": "2024-08-13T18:00:00Z", "text": "EFFIS: 10,630 ha burned in East Attica", "acres": 26267, "source": "EFFIS via Wikipedia"},
            ],
            "sources": [
                {"label": "Wikipedia · 2024 Attica wildfires", "url": "https://en.wikipedia.org/wiki/2024_Attica_wildfires"},
                {"label": "Ta Nea · Copernicus burned area", "url": "https://www.tanea.gr/2024/08/14/greece/fotia-stin-attiki-staxti-eginan-pano-apo-100-000-stremmata-ta-nea-dedomena-apo-to-copernicus/amp/"},
            ],
        },
        "fleet": "intl",
    },
}

SATELLITES = {
    "S-NPP": "noaa-nesdis-snpp-pds",
    "NOAA-20": "noaa-nesdis-n20-pds",
    "NOAA-21": "noaa-nesdis-n21-pds",
}
