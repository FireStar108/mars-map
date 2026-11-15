# Данные Mars Map

Всё, что скачано из интернета для страницы, лежит здесь в исходном виде. Файлы в `assets/` и `js/nomenclature.js` собираются из этой папки одним скриптом:

```sh
cd mars_map
python3 data/scripts/build_assets.py   # нужны numpy и Pillow с WebP
```

## Mission terrain

The three Gale crater landing zones use the local HiRISE stereo DTM
`hirise-gale/DTEEC_019698_1750_019988_1750_U01.IMG`. Rebuild their compact
terrain packages from the copied project root with:

```sh
python3 data/scripts/build_zones.py   # needs numpy and Pillow
```

This writes `assets/zones/{boxwork,gediz,uncharted}.js`, relief textures, and
map thumbnails. The near terrain is sampled at about 1 m/pixel; the far
terrain is a 600 m, 8 m/pixel height tile. The input PDS label identifies the
dataset as `MRO-M-HIRISE-5-DTM-V1.0`, product
`DTEEC_019698_1750_019988_1750_U01`, from the University of Arizona HiRISE
team. The public dataset is available through the
[NASA/USGS HiRISE DTM archive](https://registry.opendata.aws/nasa-usgs-mars-hirise-dtms/)
(CC0 1.0; DOI [10.5066/P9VQTS7V](https://doi.org/10.5066/P9VQTS7V)).

Implementation limitations: mission relief textures are generated from the
DTM as hillshades; the locally available HiRISE JP2 orthoimage is not currently
used to color the terrain. The generated sand layer is deliberately all zero:
there is no validated sand classification for these zones yet. Far-tile
no-data samples are filled from nearby valid DTM samples for rendering, so
those edge elevations should not be treated as measured terrain.

The mission-photo previews are stored in `assets/missions/`; their NASA Images
API identifiers, captions, credits, and source links are recorded alongside
the mission definitions in `js/missions.js`. See the root `CASE_LOG.md` for
the source inventory and implementation notes.

## Используемые источники

| Папка | Что это | Откуда | Лицензия | Во что превращается |
|---|---|---|---|---|
| `mola/` | `megt90n000eb.img` + `.lbl` — карта высот MGS MOLA MEGDR, 16 пикс/° (5760×2880, int16 big-endian, метры над ареоидом, долгота 0…360° в.д.) | [PDS Geosciences: MOLA MEGDR](https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/) · [описание продукта](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html) | NASA, общественное достояние | `assets/mars_normal.js` — карта нормалей 5760×2880; `assets/mola_8ppd.js` — высоты 2880×1440 для 3D, профилей и выделения областей |
| `iau-nomenclature/` | `MARS_nomenclature_center_pts.*` — шейп-файл со всеми утверждёнными названиями МАС для Марса (2055 объектов: кратеры, горы, равнины, каньоны, пятна альбедо и др.) | [USGS Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/) · [GIS-загрузки](https://planetarynames.wr.usgs.gov/GIS_Downloads) · [прямая ссылка](https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MARS_nomenclature_center_pts.zip) | IAU / USGS, свободно | `js/nomenclature.js`; `js/feature-info.js` — происхождение названий по-русски (`scripts/origins_ru.py`), год названия, снимок |
| `solar-system-scope/` | `8k_mars.jpg` (8192×4096) — цветная карта Марса; `2k_mars.jpg` — первая версия, больше не используется | [Solar System Scope Textures](https://www.solarsystemscope.com/textures/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `assets/mars_texture.js` |
| `hrsc-mola/` | `Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif` — глобальная карта высот HRSC + MOLA, 200 м/пикс (GeoTIFF 106694×53347, int16 без сжатия, по строке на полосу, 11,4 ГБ) + метаданные `.lbl`, `.vrt`, `.md5` | [USGS Astrogeology](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m) · [файл](https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif) | MOLA — CC0, HRSC — CC BY-SA 3.0 IGO; ссылка: Fergason, Hare, Laura (2018) | `assets/dem/` — пирамида тайлов для 3D-поверхности (`scripts/build_dem_tiles.py`): уровни 0–7, тайлы по 180/2^L°, 419×419 высот, на уровне 7 шаг ~200 м; ~3,5 ГБ, ~43 тыс. файлов |
| — (онлайн) | Глобальная мозаика снимков MRO CTX, ~5 м/пикс, оттенки серого (~5 ТБ). Не скачивается и на карте не используется — только при сборке снимков карточек объектов (`scripts/build_feature_photos.py` берёт тайлы из сервиса) | [Murray Lab](https://murray-lab.caltech.edu/CTX/) · сервис [Esri OnMars CTX](https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer) | свободно с указанием авторства: J. L. Dickson et al., Murray Lab (Caltech); MRO CTX — NASA/JPL/MSSS | `assets/photos/` |
| `scripts/` | `build_assets.py` — сборка ресурсов из MOLA, цветной карты и каталога МАС; `build_dem_tiles.py` — нарезка HRSC + MOLA на тайлы; `download_hrsc_mola.py` — загрузка HRSC + MOLA с докачкой и проверкой md5; `build_feature_photos.py` — снимки для карточек объектов (`assets/photos/`: вырезки из мозаики CTX, где есть — фото из Wikimedia Commons по Wikidata, авторы в `feature-photos.json`); `build_feature_info.py` — сборка `js/feature-info.js` | — | — | — |

В каталоге МАС нет безымянных кратеров: в нём только официальные названия, это весь список. Мелкие кратеры без названия на карте есть, но не подписаны.

Русские названия крупных объектов, описания ключевых объектов и список источников для панели находятся в `js/relief-data.js`.

## Найденные, но не скачанные карты высот

Пригодятся для детальной карты: они точнее, но очень большие или покрывают только отдельные участки.

| Набор | Разрешение | Покрытие | Ссылка |
|---|---|---|---|
| MOLA MEGDR 32/64/128 пикс/° | до 463 м | вся планета | [PDS Geosciences](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html) |
| HRSC DTM (Mars Express) | 50–100 м | регионы | [HRSCview, FU Berlin](http://hrscview.fu-berlin.de/) |
| CTX DEM | ~20 м | регионы (Езеро и др.) | [USGS: Mars 2020 CTX DEM](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic) |
| HiRISE DTM | 1–2 м | сотни участков | [UArizona HiRISE](https://www.uahirise.org/dtm/) · [AWS Open Data](https://registry.opendata.aws/nasa-usgs-mars-hirise-dtms/) |
| CTX Global Mosaic (снимки, не высоты) | 5 м | вся планета | [Murray Lab](https://murray-lab.caltech.edu/CTX/) |

## Прочее

- Уровень «Девтеронил −3,79 км» в панели — гипотетическая береговая линия древнего океана (контакт 2 по Head et al., 1999, около −3792 ± 236 м). Обзор оценок: [Sholes et al., 2021](https://sfsholes.github.io/papers/Sholes2021_WhereAreMarsOceanShorelines.pdf).
- Свет сделан по образцу [in-space.ru/planetmodel](https://in-space.ru/planetmodel/): жёсткий направленный источник и почти чёрный фоновый свет. Файлы с того сайта не копировались — карта нормалей построена заново из MOLA.

## Rebuild the three playable zones

The browser-ready zone assets are included. To regenerate them using the archived HiRISE dataset, run from this copy with Python, NumPy, and Pillow:

```sh
python3 data/scripts/build_zones.py --dtm ../the_mars_map/data/hirise-gale/DTEEC_019698_1750_019988_1750_U01.IMG
```

Other raw downloads described above are held in the original project. See the top-level CASE_LOG.md for data used in the playable flow.

## Optical imagery preparation

Run `python3 data/scripts/build_optical.py` after the elevation builder to attempt registered image crops from the original project's RED JP2. As of 2026-11-15, local RED and IRB files fail decoding with a broken-data-stream error. The playable build retains the DTM-derived previews and textures. Pending imagery work is recorded in CASE_LOG.md.

## Current offline Wikipedia cards and boundary audit (2026-11-15)

The earlier inventory above describes the source project; it does not imply all of
those raw archives or `assets/photos` exist in this playable copy.

`python3 data/scripts/build_wikipedia.py` followed by
`python3 data/scripts/extend_wikipedia.py` rebuilds `assets/wikipedia/catalogue.js`
and its small local image files. It uses exact candidate article titles, rejects
non-Mars coordinates and disambiguation pages, and stores source revisions,
matching evidence, authors and licenses in `data/wikipedia-sources.json`.
A manually reviewed image/license exception, when needed, is recorded in
`data/wikipedia-image-overrides.json`; it is not a general license fallback.
The download cache lives at `/tmp/mars-map-wikipedia-cache`; network requests are
throttled, honor Retry-After and reuse successful responses. The second script
requires BeautifulSoup4; it adds crater-table rows and IAU-linked Wikidata/Commons
references, preserving exact table anchors and image attribution. Its small
identity snapshots are `data/wikidata-{articles,images}.json`. Missing articles or
reusable images are explicit, never substituted with a namesake's image. Text
excerpts are attributed to Wikipedia contributors under CC BY-SA 4.0. The atlas
code and other data are not implied to share that text license.

`data/boundary-audit.json` records checks for all 2,054 named objects. Run
`python3 data/scripts/audit_boundaries.py` to validate, or add `--apply` to withhold
failed contours and write audit metadata. Its Python environment needs NumPy and
Shapely. Rebuilding areas also requires SciPy, rasterio, tifffile and Pillow and
access to the original local HRSC/MOLA source. Always audit after rebuilding.
Checks cover topology, finite coordinates, the spherical projection round trip,
known extraction-crop artifacts and crater-centre alignment. They do not certify
geological boundaries. `data/boundary-review-input.json` records the 331 original
crop-dominated candidates selected for re-analysis; Copais Palus was also rebuilt
for a polygon self-intersection. The current bundle retains 1,503 approximate
contours and explicitly withholds 551 unresolved boundaries.
