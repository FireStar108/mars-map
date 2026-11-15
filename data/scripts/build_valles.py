"""Build a 2 km Southwest Candor study area from official HiRISE COG windows.

Requires rasterio, numpy and Pillow. HTTP range reads use source COG blocks and
available overviews. Cache files live in /tmp. Runtime uses bundled classic JS.
"""
import base64
import json
import math
from pathlib import Path
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/valles'
PREFIX = 'https://astrogeo-ard.s3.us-west-2.amazonaws.com/mars/mro/hirise/controlled/dtm/PSP_001918_1735_PSP_001984_1735/'
DEM = 'DTEEC_001918_1735_001984_1735_U01.tif'
OPT = 'PSP_001918_1735_RED_A_01_ORTHO.tif'
SIZE = 2000
CELL = 5
N = SIZE // CELL
SCALE = math.pi * 3396190 / 180
# Source-pixel centre selected from the DTM overview, fixed for reproducibility.
CENTER_COL, CENTER_ROW = 2800, 5000
CACHE = Path('/tmp/valles-candor-crop-v1.npz')


def acquire():
    if CACHE.exists():
        cached = np.load(CACHE)
        return {key: cached[key] for key in cached.files}
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_TIMEOUT='60', GDAL_HTTP_MAX_RETRY='3'):
        with rasterio.open('/vsicurl/' + PREFIX + DEM) as src:
            cx, cy = src.transform * (CENTER_COL, CENTER_ROW)
            coslat = math.cos(math.radians(cy / SCALE))
            left, right = cx - SIZE / 2 / coslat, cx + SIZE / 2 / coslat
            bottom, top = cy - SIZE / 2, cy + SIZE / 2
            window = from_bounds(left, bottom, right, top, src.transform)
            dem = src.read(1, window=window, out_shape=(SIZE, SIZE), masked=True, resampling=Resampling.bilinear).filled(np.nan)
            dem_pixel = src.res[0]
            print('DTM window acquired', dem.shape, 'valid', np.isfinite(dem).mean(), flush=True)
        with rasterio.open('/vsicurl/' + PREFIX + OPT) as src:
            window = from_bounds(left, bottom, right, top, src.transform)
            optical = src.read(1, window=window, out_shape=(2048, 2048), masked=True, resampling=Resampling.average).filled(0)
            optical_pixel = src.res[0]
            print('Ortho window acquired', optical.shape, flush=True)
    result = dict(dem=dem, optical=optical, left=left, top=top, coslat=coslat, dem_pixel=dem_pixel, optical_pixel=optical_pixel)
    np.savez_compressed(CACHE, **result)
    return result


def main():
    source = acquire()
    OUT.mkdir(parents=True, exist_ok=True)
    dem = source['dem']
    dem[~np.isfinite(dem) | (dem < -10000) | (dem > 30000)] = np.nan
    gy, gx = np.gradient(dem, 1.0)
    native_slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    heights = dem.reshape(N, CELL, N, CELL).mean(axis=(1, 3))
    slopes = native_slope.reshape(N, CELL, N, CELL).max(axis=(1, 3))
    valid = np.isfinite(heights) & np.isfinite(slopes)
    left, top, coslat = float(source['left']), float(source['top']), float(source['coslat'])

    def point(x, y, **properties):
        return dict(x=x, y=y, lon=(left + x / coslat) / SCALE, lat=(top - y) / SCALE, **properties)

    def values(grid):
        return [round(float(v), 2) if np.isfinite(v) else None for v in grid.ravel()]

    base = point(492.5, 1107.5, name='Proposed survey camp')
    targets = [
        point(1147.5, 997.5, id='ridge', name='Layered ridge survey', subtitle='Proposed geological observation', description='Photograph exposed layering and compare bedding orientation across this mapped relief. Target selected from orbital terrain and imagery; no surface mission has surveyed this point.', science='Proposed stratigraphic observations in layered deposits.'),
        point(742.5, 1037.5, id='near', name='Nearby terrain survey', subtitle='Shorter reconnaissance alternative', description='Document local slopes, ground texture and obstacles before a longer traverse. The observation location is hypothetical and requires ground verification.', science='Proposed terrain reconnaissance.'),
        point(342.5, 1452.5, id='shelter', name='Shelter assessment', subtitle='Hypothetical camp assessment', description='Inspect terrain shielding, surface stability and access. Orbital topography alone does not establish shelter safety, ice availability or habitability.', science='Proposed suitability assessment, with ground verification required.'),
    ]
    sources = dict(dem=PREFIX + DEM, optical=PREFIX + OPT, overview='https://www.uahirise.org/dtm/PSP_001918_1735', archive='https://registry.opendata.aws/nasa-usgs-mars-hirise-dtms/')
    metadata = dict(name='Southwest Candor Chasma', region='Valles Marineris', width=N, height=N, cellSize=CELL, extent=SIZE,
                    nativeDemResolution=float(source['dem_pixel']), opticalResolution=float(source['optical_pixel']), displayImageResolution=SIZE/2048, displayOpticalResolution=SIZE/2048,
                    origin=dict(lon=left/SCALE,lat=top/SCALE), center=dict(lon=(left+SIZE/2/coslat)/SCALE,lat=(top-SIZE/2)/SCALE),
                    metersPerDegree=SCALE, cosLatitude=coslat, base=base, targets=targets, sources=sources,
                    projection='IAU 2015 Mars sphere R3396190; planetocentric, east-positive; local metric resampling from equirectangular lat_ts0',
                    elevationDatum='Source HiRISE DTM elevations controlled to MOLA; source vertical reference retained',
                    credit='NASA/JPL-Caltech/University of Arizona; USGS Astrogeology COG conversion', license='CC0 1.0 (USGS archive)', accessed='2026-11-15',
                    sourceProducts=[DEM[:-4],OPT[:-4]], sourceCropCenterPixel=[CENTER_COL,CENTER_ROW],
                    slopeMethod='Maximum gradient angle of resampled approximately 1 m DTM samples inside each 5 m routing cell',
                    limitations=['Hypothetical camp and science targets; no rover ground truth or weather station at this site.',
                                 'DTM spacing describes sampling, not absolute accuracy. Small rocks, sand bearing strength and overhangs remain unresolved.',
                                 'Weather and human traversal parameters are scenarios. Topographic screening does not prove habitability.',
                                 'Orthorectified RED-band imagery is displayed in grayscale; 0.253 m source is reduced to approximately 0.98 m/pixel for the browser.'])
    data = dict(metadata, heights=values(heights), slopes=values(slopes), valid=valid.ravel().astype(int).tolist())
    (OUT/'terrain.js').write_text('window.VALLES = ' + json.dumps(data,separators=(',',':'),allow_nan=False) + ';\n')
    (OUT/'site.js').write_text('window.VALLES_SITE = ' + json.dumps(metadata,separators=(',',':'),allow_nan=False) + ';\n')
    optical = source['optical']
    sampled = optical[optical > 0]
    low, high = np.percentile(sampled, [0.5, 99.5])
    image = np.clip((optical-low)/(high-low)*255,0,255).astype(np.uint8)
    Image.fromarray(image).save(OUT/'surface.jpg',quality=91)
    encoded = base64.b64encode((OUT/'surface.jpg').read_bytes()).decode('ascii')
    (OUT/'surface-data.js').write_text('window.VALLES_SURFACE = "data:image/jpeg;base64,'+encoded+'";\n')
    print('Complete',OUT,'valid',valid.mean(),'height',np.nanmin(heights),np.nanmax(heights),'slope percentiles',np.nanpercentile(slopes,[10,25,50,75,90]),flush=True)


if __name__ == '__main__':
    main()
