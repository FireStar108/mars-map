# Mars Map

Interactive 3D Mars atlas with 2,054 named features, HRSC/MOLA shaded relief,
generated weather and hazard scenarios, long-distance routes and a detailed
Valles Marineris / Southwest Candor terrain planner.

**Explore Mars, compare conditions, and plan a science expedition with enough
time to return.** Mars Map connects a planet-wide overview with a detailed
walking-route planner. It explains route choices through terrain, weather
scenarios, travel time and a required return reserve.

Public site: https://mars-map-firestar108.candyarena32.chatgpt.site

Public source repository: https://github.com/FireStar108/mars-map

## Two connected maps

| Mode | What you can do | Scale |
| --- | --- | --- |
| **Planet · 3D** | Rotate and zoom the globe, browse named landforms, inspect evidence and photos, compare map layers, place departure/destination points and compare regional routes. | Global HRSC/MOLA relief from a 200 m source; long-distance routing uses a coarser 1° grid, approximately 59 km north–south. |
| **Valles Marineris · detailed** | Explore a 2 × 2 km patch of Southwest Candor Chasma in 2D/3D, place a proposed base and science destination, and compare short and adaptive walking routes. | HiRISE DTM at approximately 1.01 m source spacing; 0.25 m source imagery displayed at approximately 0.98 m/pixel; 5 m routing cells. |

The local planner accounts for outward travel, a science stop, the return leg
and a configurable reserve. A route that exceeds the time budget or scenario
limits is marked **HOLD**. Users can change conditions, save a baseline and
compare how the route, travel time and remaining reserve change.

## Main features

- **Mars catalogue:** 2,054 unique named IAU features, category filters,
  searchable locations and labels that appear by zoom level. Selecting a
  resolved feature reveals one contour, approaches it and displays its details.
- **Map layers:** shaded relief, colour imagery, elevation, historical dust
  detections, generated weather, a relative radiation/shielding proxy and
  generated sand, boulder, rockfall, cold and solar-event layers. Each layer has
  a colour legend explaining its scale and meaning.
- **Region cards:** terrain and scenario-hazard screening, strongest sampled
  hazard direction/distance, Wikipedia context, locally stored images and
  attribution where available.
- **Scenario controls:** adjustable temperature, wind, visibility and dust,
  plus repeatable seeded hazard generation. Rendering, route assessment and
  region screening share the scenario fields.
- **Route comparison:** a short path versus an adaptive path, terrain profiles,
  travel estimates, closure explanations and scenario comparison. Local routes
  can be placed directly on the 3D terrain and previewed as an expedition.
- **Mission context:** approach known rover landing sites from the globe;
  the included Gale mission flow adds rover scouting, route review and an
  astronaut EVA demonstration.

## Data used

| Source | Use in this project |
| --- | --- |
| [IAU / USGS Gazetteer](https://planetarynames.wr.usgs.gov/GIS_Downloads) | Adopted Mars names, feature types, centres and recorded dimensions. The bundled catalogue contains 2,054 unique objects after duplicate removal. |
| [HRSC / MOLA blended global DEM](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m) | Global shaded-relief tiles and terrain-derived regional summaries. Attribution: USGS / Fergason, Hare & Laura; ESA/DLR/FU Berlin HRSC; NASA MOLA. |
| [NASA PDS MOLA MEGDR](https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/) | Global elevation mesh, regional profiles and long-distance route context. |
| [HiRISE Southwest Candor stereo terrain](https://www.uahirise.org/dtm/PSP_001918_1735) · [USGS archive](https://registry.opendata.aws/nasa-usgs-mars-hirise-dtms/) | Registered DTM and orthophoto for the detailed Valles Marineris patch. NASA/JPL-Caltech/University of Arizona; USGS archive conversion. |
| [OMEGA / Mars Express Dust Storm Catalogue v2](https://zenodo.org/records/18618930) | 448 historical detections from Mars years 26–30, grouped by season. These are historical observations, not a live forecast. CC BY 4.0. |
| [Solar System Scope](https://www.solarsystemscope.com/textures/) | The global colour overview, CC BY 4.0. |
| Wikipedia / Wikimedia Commons | Matched descriptions, photographs, article revisions and individual credits in [the local attribution manifest](data/wikipedia-sources.json). Missing coverage is stated explicitly. |

## Technology and implementation

| Component | Technology |
| --- | --- |
| Interface | HTML, CSS and browser JavaScript; responsive desktop/mobile layouts. |
| 3D maps | Three.js 0.169.0 and WebGL, with custom globe/terrain controls. |
| Maps and charts | Canvas 2D textures, overlays and elevation profiles; on-demand WebP terrain tiles with a bounded cache. |
| Planning | Custom grid-based A* search, shared weather/hazard fields and comparative time/risk models. |
| Data preparation | Python terrain/image processing and geometry auditing, using NumPy, Pillow and geospatial tools. |
| Build and hosting | Node.js build scripts; an ES-module Cloudflare Worker and R2 file storage, published through Sites. |
| Verification | Asset/data checks, isolated Puppeteer/Chrome interaction checks and Worker serving/security checks. |

## Evidence and limits

This is an exploration and planning prototype. Generated conditions and risk
indices are scenarios, not current Mars observations or validated astronaut
safety limits. The radiation layer is an altitude-based relative shielding
proxy; it does not measure dose or ground radioactivity. A strong solar-event
scenario requires shelter across the map rather than a geographic detour.

The catalogue provides named locations, not official geological boundary
polygons. This build shows 1,503 approximate derived contours and explicitly
withholds 551 unresolved boundaries. Geometry checks do not establish a true
physical border. Wikipedia descriptions and images are not available for every
object.

Fine image spacing does not make the global route grid equally precise.
The local Valles patch covers only a small part of the canyon system; its base
and science stops are proposed locations. Small obstacles, soil strength,
rock stability, consumables and rescue logistics require further evidence.

## Run

No JavaScript dependencies are required. Serve this directory with a static
HTTP server, for example `python3 -m http.server 8080`, then open
`http://localhost:8080`.

For direct `file://` use after cloning, run `npm run offline` once, then open
`index.html`. This reconstructs the ignored local tile transport files from the
tracked WebP assets. The existing development folder already has these files.

## Publish

`npm run build` prepares public files in `outputs/site/` and a small R2-backed
hosting Worker in `dist/`. The complete relief pyramid, Wikipedia imagery and
runtime data are uploaded to the Site's file bucket, preserving full image
dimensions and avoiding the hosting archive size limit. Internal logs and tests
are excluded from website serving. Both the source repository and website are public.

Small updates reuse the sealed asset snapshot in `.openai/static-base.json`.
The build embeds changed files in the Worker (up to 4 MiB total) and reuses
unchanged images and tiles from R2. Publish the resulting archive directly;
no upload secret or repeat map upload is needed. HTML, scripts and styles change
together in one deployment. Larger data changes require publishing a new sealed
asset base and updating its snapshot.

`scripts/upload-site.cjs` accepts the Site URL and a temporary upload key through
hidden stdin. Uploads verify SHA-256 checksums and are permanently sealed once
all files and bytes are present when publishing an initial static base. The runtime upload secret is removed after
publication; the public site then only serves files. The key is never stored in
Git or client code. For a conventional static host, use `npm run build:web` and
publish `outputs/site/` directly.

The default map uses DEM-derived shaded relief from HRSC/MOLA, approximately
200 m source spacing. Web textures retain the full tile dimensions. The 3D
display mesh and global route search are coarser; weather and hazards are
explicit scenarios, not current observations or operational safety guidance.

## Data and attribution

Dataset provenance, exact source URLs and licenses are available in the
in-app **Data & model** panel, `data/README.md`,
`assets/global/hrsc/manifest.json` and `data/wikipedia-sources.json`.
HRSC-derived relief: ESA/DLR/FU Berlin / USGS, CC BY-SA 3.0 IGO.
Wikipedia text and individual Wikimedia images retain their separate credits.

The 11.38 GB original DEM is not required at runtime or stored in this repo.
The terrain builder and its source URL are included for reproducibility.
