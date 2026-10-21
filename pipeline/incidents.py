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
}

SATELLITES = {
    "S-NPP": "noaa-nesdis-snpp-pds",
    "NOAA-20": "noaa-nesdis-n20-pds",
    "NOAA-21": "noaa-nesdis-n21-pds",
}
