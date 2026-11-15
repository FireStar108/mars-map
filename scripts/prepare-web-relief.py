"""Convert local relief transport copies to smaller, same-size web textures."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import base64, io, json, time
from PIL import Image

root=Path(__file__).resolve().parents[1]/'assets/global/hrsc'
files=sorted(p for p in root.glob('[0-6]/*.js'))
start=time.time()
def convert(p):
    dst=p.with_suffix('.webp')
    if dst.exists() and dst.stat().st_mtime >= p.stat().st_mtime: return dst.stat().st_size
    text=p.read_text()
    raw=base64.b64decode(text.split('base64,',1)[1].split('"',1)[0])
    with Image.open(io.BytesIO(raw)) as image:
        assert image.size==(832,832), p
        image.save(dst, format='WEBP', quality=85, method=1)
    return dst.stat().st_size
total=0
with ThreadPoolExecutor(max_workers=4) as pool:
    for n,size in enumerate(pool.map(convert,files),1):
        total+=size
        if n%1000==0: print(f'{n}/{len(files)} tiles · {time.time()-start:.0f}s',flush=True)
assert len(files)==10922
metadata=json.loads((root/'manifest.json').read_text())
metadata['webFormat']='webp'
metadata['webTileCount']=len(files)
metadata['webTileBytes']=total
metadata['webEncoding']='WebP quality 85, identical pixel dimensions; original DEM and terrain statistics unchanged'
(root/'manifest.json').write_text(json.dumps(metadata,indent=2)+'\n')
base=(root/'base.js').read_text().split('window.MARS_HRSC=')[0]
(root/'base.js').write_text(base+'window.MARS_HRSC='+json.dumps(metadata)+';\n')
print(f'Complete: {len(files)} tiles, {total} bytes, {time.time()-start:.0f}s',flush=True)
