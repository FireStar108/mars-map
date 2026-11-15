"""Download only byte ranges covering a 900 m Jezero delta patch.
Requires numpy, Pillow, tifffile. No full planetary rasters are downloaded.
USGS uncompressed strip TIFFs permit a narrow range request for each cropped row.
"""
import concurrent.futures, http.client, io, json, math, pathlib, threading, time
import numpy as np
import tifffile
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets' / 'jezero'
HOST = 'asc-pds-services.s3.us-west-2.amazonaws.com'
PATH = '/mosaic/mars2020_trn/HiRISE/'
DEM = 'JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif'
OPT = 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif'
SCALE = math.pi * 3396190 / 180
LAT, LON, SIZE = 18.455, 77.4075, 900
COS = math.cos(math.radians(LAT))
LEFT, TOP = LON*SCALE - SIZE/(2*COS), LAT*SCALE + SIZE/2
local = threading.local()

def get_range(name, start, length):
    for attempt in range(5):
        try:
            if not hasattr(local,'conn'): local.conn=http.client.HTTPSConnection(HOST,timeout=45)
            local.conn.request('GET', PATH+name, headers={'Range': f'bytes={start}-{start+length-1}'})
            response=local.conn.getresponse()
            if response.status != 206: raise RuntimeError(f'Expected partial content, got {response.status}')
            content=response.read()
            if len(content)!=length: raise RuntimeError('Incomplete byte range')
            return content
        except Exception:
            if hasattr(local,'conn'): local.conn.close(); del local.conn
            if attempt==4: raise
            time.sleep(attempt+1)

def crop(name, pixel, dtype):
    cache=pathlib.Path('/tmp')/('jezero-crop-'+str(pixel)+'.npy')
    if cache.exists(): return np.load(cache)
    header=get_range(name,0,1500000)
    with tifffile.TiffFile(io.BytesIO(header)) as tif:
        page=tif.pages[0]
        assert page.compression==1 and page.rowsperstrip==1
        offsets=page.dataoffsets
        x0=round((LEFT-4577366)/pixel); y0=round((1106618-TOP)/pixel)
        width=round(SIZE/COS/pixel); height=round(SIZE/pixel)
        item=np.dtype(dtype).itemsize
        def row(y):
            return np.frombuffer(get_range(name,offsets[y0+y]+x0*item,width*item),dtype=dtype)
        result=np.empty((height,width),dtype=dtype)
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
            for y,values in enumerate(pool.map(row,range(height))):
                result[y]=values
                if y%500==0: print(name[:20],y,'/',height,flush=True)
    np.save(cache,result)
    return result

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    dem=crop(DEM,1,'<f4')
    optical=crop(OPT,.25,'u1')
    valid=np.isfinite(dem)&(dem>-10000)&(dem<10000)
    clean=np.where(valid,dem,np.nan)
    # Resample Equirectangular lat_ts=0 east-west scale to local physical metres.
    square=np.array(Image.fromarray(clean).resize((SIZE,SIZE),Image.Resampling.BILINEAR))
    gy,gx=np.gradient(square)
    slope=np.degrees(np.arctan(np.hypot(gx,gy)))
    n=SIZE//5
    grid=square.reshape(n,5,n,5).mean(axis=(1,3))
    slopes=slope.reshape(n,5,n,5).max(axis=(1,3))
    def arr(a): return [round(float(v),2) if np.isfinite(v) else None for v in a.ravel()]
    def point(lon,lat): return {'x':round((lon*SCALE-LEFT)*COS,2),'y':round(TOP-lat*SCALE,2),'lon':lon,'lat':lat}
    data={'width':n,'height':n,'cellSize':5,'extent':SIZE,'nativeDemResolution':1,'opticalResolution':.25,'origin':{'lon':LEFT/SCALE,'lat':TOP/SCALE},'metersPerDegree':SCALE,'cosLatitude':COS,
      'base':dict(point(77.4090,18.4495),name='Hypothetical habitat'),
      'targets':[dict(point(77.40592495,18.45864728),id='ridge',name='Hogwallow Flats',subtitle='Wildcat Ridge vicinity',description='Photograph fine layering and compare sediment grain sizes near the Wildcat Ridge sampling area. Perseverance collected Hazeltop here on sol 509. Marker follows the rover location, not the exact rock.',science='Observed sedimentary outcrop; proposed astronaut investigation.'),
                 dict(point(77.40851,18.454105),id='near',name='Delta approach',subtitle='Nearby survey alternative',description='Survey the delta-facing outcrops and photograph the transition from crater floor to delta. This shorter scenario target uses the rover position at sol 434; the scientific task is proposed.',science='Proposed reconnaissance at a documented rover position.')],
      'sources':{'dem':'https://'+HOST+PATH+DEM,'optical':'https://'+HOST+PATH+OPT},'heights':arr(grid),'slopes':arr(slopes)}
    (OUT/'terrain.js').write_text('window.JEZERO = '+json.dumps(data,separators=(',',':'))+';\n')
    Image.fromarray(optical).resize((SIZE*4,SIZE*4),Image.Resampling.LANCZOS).save(OUT/'surface.jpg',quality=93)
    # Preserve exact downloaded 1m samples in a compact archival crop.
    tifffile.imwrite(OUT/'dtm-crop.tif',dem,compression='deflate',description=json.dumps({'left':LEFT,'top':TOP,'source':data['sources']['dem'],'pixel':1,'projection':'Mars sphere R3396190 equirectangular lat_ts0 lon0; crop offsets rounded to source pixels'}))
    print('Completed',OUT,'valid',valid.mean(),'elevation',np.nanmin(square),np.nanmax(square),flush=True)

if __name__=='__main__': main()
