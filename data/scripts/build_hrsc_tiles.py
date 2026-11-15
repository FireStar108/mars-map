"""Offline native-resolution relief pyramid from the user's HRSC/MOLA DEM.

Read the large, scanline-organized input once in latitude strips. Runtime uses
small classic-script image tiles so the atlas still works from file://.
"""
import argparse
import base64
import io
import json
import time
from pathlib import Path
import numpy as np
import rasterio
from rasterio.windows import Window
from rasterio.enums import Resampling
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('--output', type=Path, default=Path('assets/global/hrsc'))
args = parser.parse_args()
out = args.output
out.mkdir(parents=True, exist_ok=True)
SIZE, LEVEL = 832, 6
NX, NY = 128, 64
W, H = NX * SIZE, NY * SIZE
R = 3396190.0
spacing = 2 * np.pi * R / W
start = time.time()
count = np.zeros((180, 360), dtype=np.int64)
steep = np.zeros_like(count)
minimum = np.full((180, 360), 32767, dtype=np.float32)
maximum = np.full((180, 360), -32768, dtype=np.float32)
peak = np.zeros((180, 360), dtype=np.float32)

def save_tile(z, x, y, image):
    directory = out / str(z)
    directory.mkdir(exist_ok=True)
    buf = io.BytesIO()
    image.save(buf, format='JPEG', quality=88, subsampling=0)
    encoded = base64.b64encode(buf.getvalue()).decode()
    (directory / f'{x}_{y}.js').write_text(
        f'window.MarsTerrainTiles.receive({z},{x},{y},"data:image/jpeg;base64,{encoded}");\n')

def read_tile(z, x, y):
    text = (out / str(z) / f'{x}_{y}.js').read_text()
    return Image.open(io.BytesIO(base64.b64decode(text.split('base64,')[1].split('"')[0])))

with rasterio.open(args.source) as src:
    for ty in range(NY):
        lo, hi = max(0, ty * SIZE - 1), min(H, (ty + 1) * SIZE + 1)
        strip = src.read(1, window=Window(0, lo * src.height / H, src.width, (hi - lo) * src.height / H),
                         out_shape=(hi - lo, W), resampling=Resampling.bilinear)
        if ty == 0: strip = np.pad(strip, ((1, 0), (0, 0)), mode='edge')
        if ty == NY - 1: strip = np.pad(strip, ((0, 1), (0, 0)), mode='edge')
        lat = 90 - (ty * SIZE + np.arange(SIZE) + .5) * 180 / H
        dx = spacing * np.maximum(.03, np.cos(np.radians(lat)))[:, None]
        grid_rows = np.minimum(179, ((ty * SIZE + np.arange(SIZE)) * 180 / H).astype(int))
        for tx in range(NX):
            cols = (np.arange(tx * SIZE - 1, (tx + 1) * SIZE + 1) % W)
            a = strip[:, cols].astype(np.float32)
            valid = a[1:-1, 1:-1] > -32000
            a[a < -32000] = 0
            z = a[1:-1, 1:-1]
            east = (a[1:-1, 2:] - a[1:-1, :-2]) / (2 * dx)
            north = (a[:-2, 1:-1] - a[2:, 1:-1]) / (2 * spacing)
            slope = np.degrees(np.arctan(np.hypot(east, north)))
            # Fixed multi-direction relief illumination, not surface photography.
            ex, no = east * 3.2, north * 3.2
            normal = np.sqrt(1 + ex * ex + no * no)
            shade = np.clip((.7 + .40 * ex - .50 * no) / normal, 0, 1)
            fill = np.clip((.65 - .35 * ex - .30 * no) / normal, 0, 1)
            light = .32 + .68 * shade + .15 * fill
            t = np.clip((z + 8500) / 29000, 0, 1)
            rgb = np.stack([134 + 100*t, 112 + 95*t, 91 + 90*t], axis=-1)
            rgb = np.clip(rgb * light[..., None], 0, 255).astype(np.uint8)
            rgb[~valid] = [40, 39, 36]
            save_tile(LEVEL, tx, ty, Image.fromarray(rgb))
            grid_cols = np.minimum(359, ((tx * SIZE + np.arange(SIZE)) * 360 / W).astype(int))
            for row in np.unique(grid_rows):
                iy = np.flatnonzero(grid_rows == row)
                for col in np.unique(grid_cols):
                    ix = np.flatnonzero(grid_cols == col)
                    block = np.ix_(iy, ix)
                    good = valid[block]
                    n = int(good.sum())
                    if not n: continue
                    zz, ss = z[block][good], slope[block][good]
                    count[row, col] += n
                    steep[row, col] += np.count_nonzero(ss >= 15)
                    minimum[row, col] = min(minimum[row, col], float(zz.min()))
                    maximum[row, col] = max(maximum[row, col], float(zz.max()))
                    peak[row, col] = max(peak[row, col], float(ss.max()))
        print(f'Native HRSC strip {ty+1}/{NY} · {time.time()-start:.0f}s', flush=True)
    metadata = {'sourceFile': args.source.name, 'sourceBytes': args.source.stat().st_size,
                'sourceWidth': src.width, 'sourceHeight': src.height,
                'sourcePixelMetres': 200, 'tilePixelMetres': round(spacing, 2),
                'tileSize': SIZE, 'maxLevel': LEVEL, 'format': 'DEM-derived shaded relief, not imagery',
                'source': 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif',
                'credit': 'USGS Astrogeology / Fergason, Hare & Laura (2018) / ESA/DLR/FU Berlin HRSC / NASA MOLA',
                'license': 'HRSC-derived relief: CC BY-SA 3.0 IGO; MOLA: NASA public data',
                'licenseUrl': 'https://creativecommons.org/licenses/by-sa/3.0/igo/'}

for level in range(LEVEL-1, -1, -1):
    for y in range(2**level):
        for x in range(2**(level+1)):
            big = Image.new('RGB', (SIZE*2, SIZE*2))
            for dy in range(2):
                for dx in range(2):
                    big.paste(read_tile(level+1, x*2+dx, y*2+dy), (dx*SIZE, dy*SIZE))
            save_tile(level, x, y, big.resize((SIZE, SIZE), Image.Resampling.LANCZOS))
    print(f'Pyramid level {level} · {time.time()-start:.0f}s', flush=True)

base = Image.new('RGB', (SIZE*4, SIZE*2))
for y in range(2):
    for x in range(4): base.paste(read_tile(1, x, y), (x*SIZE, y*SIZE))
buf = io.BytesIO()
base.save(buf, format='JPEG', quality=90)
encoded = base64.b64encode(buf.getvalue()).decode()
(out / 'base.js').write_text(f'window.MARS_HRSC_BASE="data:image/jpeg;base64,{encoded}";\nwindow.MARS_HRSC={json.dumps(metadata)};\n')
valid_summary = count > 0
valid_summary[:2] = False
valid_summary[-2:] = False
terrain = {'width': 360, 'height': 180, 'sourcePixelMetres': 200,
           'polarSlopeLimitDegrees': 88,
           'summaryDegrees': 1, 'steepThresholdDegrees': 15,
           'minimum': np.where(count, minimum, 0).round().astype(int).ravel().tolist(),
           'maximum': np.where(count, maximum, 0).round().astype(int).ravel().tolist(),
           'peakSlope': np.round(peak, 1).ravel().tolist(),
           'steepPercent': np.round(100*steep/np.maximum(count, 1), 1).ravel().tolist(),
           'valid': valid_summary.astype(int).ravel().tolist()}
(out / 'terrain-summary.js').write_text('window.MARS_HRSC_SUMMARY='+json.dumps(terrain, separators=(',', ':'))+';\n')
(out / 'manifest.json').write_text(json.dumps(metadata, indent=2)+'\n')
print(f'Complete · {time.time()-start:.0f}s', flush=True)
