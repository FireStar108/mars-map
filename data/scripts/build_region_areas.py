"""Build compact areas for all inherited IAU names, without runtime DEM downloads.
Reuses the former relief.js centre/annulus threshold + connected-component method.
Inputs: local HRSC/MOLA 200 m DEM, MOLA 16 ppd and Solar System Scope texture. Outputs are approximate,
not IAU boundaries. No catalogue bounding box is used as a shape or clipping mask. Unresolved features retain their named location with no invented boundary.
Requires numpy, scipy, rasterio, Pillow, shapely; run with --source ../the_mars_map.
Then run audit_boundaries.py --apply before publishing a rebuilt bundle.
"""
import argparse, json, math, importlib.util
from pathlib import Path
import numpy as np
import tifffile
from scipy import ndimage as ndi
from rasterio.features import shapes
from PIL import Image
from shapely.geometry import Polygon, MultiPolygon, mapping
from shapely import make_valid

parser=argparse.ArgumentParser()
parser.add_argument('--source',type=Path,required=True)
parser.add_argument('--group',choices=['mons','crater','low','plat','valley','mare','other'])
parser.add_argument('--names',nargs='*')
args=parser.parse_args()
root=Path(__file__).resolve().parents[2]
source=args.source.resolve()
spec=importlib.util.spec_from_file_location('inherited',source/'data/scripts/build_assets.py')
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
groups={t:g for g,types in mod.NAME_GROUPS.items() for t in types}
rows=mod.read_dbf(source/'data/iau-nomenclature/MARS_nomenclature_center_pts.dbf')
regions=json.loads((root/'js/regions.js').read_text().split('window.MARS_REGIONS = ')[1].rstrip(';\n'))
aliases=json.loads((root/'data/region-aliases.json').read_text())
R=3396.19; N=128
hrsc=tifffile.memmap(source/'data/hrsc-mola/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif')
h=np.fromfile(source/'data/mola/megt90n000eb.img',dtype='>i2').reshape(2880,5760).astype(np.float32)
h=np.roll(h,h.shape[1]//2,axis=1)
image=np.asarray(Image.open(source/'data/solar-system-scope/8k_mars.jpg').convert('L').resize((2048,1024)),dtype=np.float32)
x,y=np.meshgrid((np.arange(N)+.5)/N*2-1,(np.arange(N)+.5)/N*2-1)

def sample(a,lat,lon):
    return ndi.map_coordinates(a,[np.clip((90-np.atleast_1d(lat))/180*a.shape[0]-.5,0,a.shape[0]-1),((np.atleast_1d(lon)+180)%360)/360*a.shape[1]-.5],order=1,mode='grid-wrap')

def fine_height(lat, lon):
    # Bilinear samples from the native, local 200 m raster. Never interpolate no-data.
    rr=np.clip((90-np.asarray(lat))/180*hrsc.shape[0]-.5,0,hrsc.shape[0]-1.001)
    cc=((np.asarray(lon)+180)%360)/360*hrsc.shape[1]-.5
    r0=np.floor(rr).astype(int); c0=np.floor(cc).astype(int)%hrsc.shape[1]
    fy=rr-r0; fx=cc-np.floor(cc)
    a=hrsc[r0,c0].astype(float); b=hrsc[r0,(c0+1)%hrsc.shape[1]].astype(float)
    c=hrsc[r0+1,c0].astype(float); d=hrsc[r0+1,(c0+1)%hrsc.shape[1]].astype(float)
    result=(a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy
    return np.where((a==-32768)|(b==-32768)|(c==-32768)|(d==-32768),np.nan,result)

def simplify(p, eps=.7):
    if len(p)<3: return p
    v=p[-1]-p[0]
    denom=np.dot(v,v)
    if denom<1e-12: distances=np.linalg.norm(p-p[0],axis=1)
    else:
        t=np.clip((p-p[0])@v/denom,0,1)
        distances=np.linalg.norm(p-(p[0]+t[:,None]*v),axis=1)
    k=int(np.argmax(distances))
    if distances[k]>eps:
        return np.vstack([simplify(p[:k+1],eps)[:-1],simplify(p[k:],eps)])
    return p[[0,-1]]

def build(r):
    group=groups.get(r['type'].split(',')[0],'other'); r['group']=group
    r['alias']=aliases.get(r['name'],'')
    lat,lon=np.radians([r['lat'],r['lon']])
    c=np.array([math.cos(lat)*math.cos(lon),math.sin(lat),-math.cos(lat)*math.sin(lon)])
    north=np.array([-math.sin(lat)*math.cos(lon),math.cos(lat),math.sin(lat)*math.sin(lon)])
    east=np.cross(north,c)
    # Original albedo fallback had no official diameter; explicitly mark a 750 km search window.
    diameter=r['diameter'] or 750
    r0=min(diameter/2/R,1.0)
    reach=1.05 if group=='valley' else 1.3 if group=='crater' else 1.5
    rmax=min(r0*reach,1.25); s=math.sin(min(rmax*1.1,1.45))
    px=x*s; py=y*s; rho=px*px+py*py
    valid=rho<s*s
    ang=np.arcsin(np.minimum(np.sqrt(rho),.999999))
    d=c[:,None,None]*np.sqrt(np.maximum(0,1-rho))+east[:,None,None]*px+north[:,None,None]*py
    lats=np.degrees(np.arcsin(np.clip(d[1],-1,1))); lons=np.degrees(np.arctan2(-d[2],d[0]))
    heights=fine_height(lats,lons)
    sampled_valid=np.isfinite(heights)
    source_valid=sampled_valid&valid
    # Values used outside valid samples are excluded from every mask and threshold.
    heights=np.where(sampled_valid,heights,sample(h,lats,lons))
    values=sample(image,lats,lons) if group=='mare' else heights.copy()
    if group in ('valley','other'):
        bg=ndi.uniform_filter(np.where(valid,values,0),size=27)/np.maximum(1e-9,ndi.uniform_filter(valid.astype(float),size=27))
        values-=bg
    # Catalogue extents validate candidate identity; they never cut output geometry.
    bounds=r['bounds']; width=(bounds['max_lon']-bounds['min_lon'])%360
    height=bounds['max_lat']-bounds['min_lat']
    west=bounds['min_lon']-width*.1
    envelope=(lats>=bounds['min_lat']-height*.1)&(lats<=bounds['max_lat']+height*.1)&(((lons-west)%360)<=width*1.2)
    depression=group in ('mare','crater','low','valley')
    center_samples=values[(ang<r0*.35)&source_valid]
    ring_samples=values[(ang>r0*.85)&(ang<r0*1.15)&source_valid]
    inner=float(np.percentile(center_samples,5 if group=='valley' else 30)) if len(center_samples) else 0
    ring=float(np.percentile(ring_samples,70)) if len(ring_samples) else 0
    best=None; score_best=float('inf')
    linear=r['type'].split(',')[0] in ('Fossa','Dorsum','Catena','Sulcus','Labyrinthus')
    if (diameter>=1.6 or group=='mare') and not linear and len(center_samples) and len(ring_samples):
        for f in (.3,.45,.6,.75,.88,.96):
            level=inner+(ring-inner)*f
            ok=(ang<=rmax)&source_valid&((values<=level) if depression else (values>=level))
            labels,num=ndi.label(ok)
            seed=labels[N//2,N//2]
            if group=='valley':
                near=np.where(ok&(ang<r0*.4)&envelope,values,np.inf)
                if not np.isfinite(near.min()): continue
                seed=labels.flat[np.argmin(near)]
            if not seed:
                near=np.where(ok&(ang<r0*.3),ang,np.inf)
                if not np.isfinite(near.min()): continue
                seed=labels.flat[np.argmin(near)]
            fill=labels==seed; count=np.count_nonzero(fill)
            # Reject flood leakage into unrelated plains instead of cutting a rectangular outline.
            if group=='valley' and width and height and np.count_nonzero(fill&~envelope)/count>.03: continue
            frac=count*(2*s/N)**2/(math.pi*r0*r0)
            if not (.015 if group=='valley' else .15)<=frac<=2: continue
            rim=np.count_nonzero(fill&(ang>rmax*.94))
            edge=fill&~ndi.binary_erosion(fill)
            # A connected fill can reach the circular crop and masquerade as a
            # round landform. Reject crop-dominated candidates, never trim them.
            if np.count_nonzero(edge&(ang>rmax*.965))/max(1,np.count_nonzero(edge))>.12: continue
            score=abs(math.log(frac))+6*rim/math.sqrt(count)
            if score<score_best: best=fill; score_best=score
    method='albedo' if group=='mare' else 'terrain'
    if linear:
        # Restore the former linear-region detector using the local HRSC/MOLA 200m DEM.
        M=N*2
        lx,ly=np.meshgrid((np.arange(M)+.5)/M*2-1,(np.arange(M)+.5)/M*2-1)
        lpx,lpy=lx*s,ly*s; lrho=lpx*lpx+lpy*lpy
        ld=c[:,None,None]*np.sqrt(np.maximum(0,1-lrho))+east[:,None,None]*lpx+north[:,None,None]*lpy
        llat=np.degrees(np.arcsin(np.clip(ld[1],-1,1))); llon=np.degrees(np.arctan2(-ld[2],ld[0]))
        rr=np.clip(((90-llat)/180*hrsc.shape[0]).astype(int),0,hrsc.shape[0]-1)
        cc=(((llon+180)%360)/360*hrsc.shape[1]).astype(int)%hrsc.shape[1]
        val=hrsc[rr,cc].astype(float); has=(val!=-32768)&(lrho<s*s)
        validl=has&(np.arcsin(np.minimum(np.sqrt(lrho),.99999))<=rmax)
        pixkm=2*s/M*R; blur_r=max(2,min(M//8,round(25/pixkm)))
        def blur(v,rad):
            return ndi.uniform_filter(np.where(has,v,0),size=2*rad+1)/np.maximum(1e-9,ndi.uniform_filter(has.astype(float),size=2*rad+1))
        bg=blur(val,blur_r); diff=val-bg
        if r['type'].startswith('Dorsum'): diff=-diff
        rough=np.sqrt(np.maximum(0,blur(diff*diff,min(M//4,blur_r*3))))
        labels,count=ndi.label(validl&(diff<-np.maximum(1.3*rough,20)),structure=np.ones((3,3)))
        keep=np.zeros((M,M),bool)
        for label in range(1,count+1):
            jj,ii=np.where(labels==label)
            if len(ii)<4: continue
            eig=np.linalg.eigvalsh(np.cov(np.array([ii,jj]),bias=True)); length=math.sqrt(12*eig[1]); elong=math.sqrt(eig[1]/max(eig[0],1/12))
            if length>=max(8,M*.03) and elong>=3 and len(ii)/length<=blur_r*1.5: keep[jj,ii]=True
        if keep.sum()>=60:
            coarse=keep.reshape(N,2,N,2).any(axis=(1,3)); allowed=validl.reshape(N,2,N,2).any(axis=(1,3))
            best=ndi.binary_dilation(coarse,iterations=2)&allowed; method='linear'

    # A failed extraction is unknown, not a circle, ellipse or catalogue rectangle.
    if best is None:
        r['area']={'n':N,'s':round(s,9),'method':'unresolved','polygons':[],
            'km2':None,'min':None,'max':None,'center':round(float(fine_height(r['lat'],r['lon']))) if np.isfinite(fine_height(r['lat'],r['lon'])) else None,
            'sourceStepMeters':200,'sampleStepMeters':round(2*s/N*R*1000),
            'reason':'The available terrain does not resolve a reliable landform boundary.'}
        return
    best=ndi.binary_fill_holes(best)
    # rasterio preserves ordered polygon edges. No scan-line edge list is used as a polygon.
    polygons=[]
    for geom,v in shapes(best.astype('uint8'),mask=best):
        if v!=1: continue
        rings=[]
        for ringxy in geom['coordinates']:
            p=np.array(ringxy[:-1]); p=(np.roll(p,1,axis=0)+2*p+np.roll(p,-1,axis=0))/4
            p=simplify(np.vstack([p,p[0]]),.45)
            if len(p)>=4: rings.append(np.round(p,1).tolist())
        if rings: polygons.append(rings)

    # Smoothing/rounding can introduce a crossing in a narrow neck. Preserve
    # valid polygon components instead of passing a self-intersection to WebGL.
    geometry=make_valid(MultiPolygon([Polygon(p[0],p[1:]) for p in polygons]))
    components=[geometry] if geometry.geom_type=='Polygon' else [p for p in geometry.geoms if p.geom_type=='Polygon']
    polygons=[[[list(pt) for pt in ring] for ring in mapping(p)['coordinates']] for p in components]
    r['area']={'n':N,'s':round(s,9),'method':method,'polygons':polygons,
        'sourceStepMeters':200,'sampleStepMeters':round(2*s/N*R*1000),
        'km2':round(float(np.sum(np.where(best,1/np.sqrt(np.maximum(.01,1-rho)),0))*(2*s/N*R)**2),2),
        'min':round(float(heights[best].min())),'max':round(float(heights[best].max())),
        'center':round(float(fine_height(r['lat'],r['lon']))) if np.isfinite(fine_height(r['lat'],r['lon'])) else None}

for i,r in enumerate(regions):
    if args.group and r['group']!=args.group: continue
    if args.names and r['name'] not in args.names: continue
    build(r)
    if i%400==0: print(i,flush=True)
(root/'js/regions.js').write_text('// IAU / USGS catalogue. HRSC/MOLA-derived areas, no nominal or bounding-box polygons.\nwindow.MARS_REGIONS = '+json.dumps(regions,ensure_ascii=False,separators=(',',':'),allow_nan=False)+';\n')
from collections import Counter
print(len(regions),Counter(r['area']['method'] for r in regions), 'bytes',(root/'js/regions.js').stat().st_size)
