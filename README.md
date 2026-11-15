# Mars Map

Interactive 3D Mars atlas with 2,054 named features, HRSC/MOLA shaded relief,
generated weather and hazard scenarios, long-distance routes and a detailed
Valles Marineris / Southwest Candor terrain planner.

Public site: https://mars-map-firestar108.candyarena32.chatgpt.site

Public source repository: https://github.com/FireStar108/mars-map

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
