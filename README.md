# Mars Map

Interactive 3D Mars atlas with 2,054 named features, HRSC/MOLA shaded relief,
generated weather and hazard scenarios, long-distance routes and a detailed
Valles Marineris / Southwest Candor terrain planner.

## Run

No JavaScript dependencies are required. Serve this directory with a static
HTTP server, for example `python3 -m http.server 8080`, then open
`http://localhost:8080`.

For direct `file://` use after cloning, run `npm run offline` once, then open
`index.html`. This reconstructs the ignored local tile transport files from the
tracked WebP assets. The existing development folder already has these files.

## Publish

`npm run build` prepares `dist/`. It includes the complete relief pyramid,
Wikipedia imagery and runtime data, while excluding internal logs and tests.
The source repository is private; the published website is public.

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
