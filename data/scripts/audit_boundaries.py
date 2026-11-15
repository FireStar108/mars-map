"""Validate every bundled polygon; --apply withholds failed contours.
Geometry/projection checks are NOT independent geological boundary validation.
Uses the builder's known circular crop radius to catch extraction-edge artifacts.
"""
import argparse,json,math
from pathlib import Path
from collections import Counter
import numpy as np
from shapely.geometry import Polygon,MultiPolygon,Point
from shapely.validation import explain_validity

parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
root=Path(__file__).resolve().parents[2];path=root/'js/regions.js'
regions=json.loads(path.read_text().split('window.MARS_REGIONS = ')[1].rstrip(';\n'))
review=json.loads((root/'data/boundary-review-input.json').read_text())
previous={r['id']:r for r in review}
records=[]
for r in regions:
    a=r['area'];issues=[];total=near=0;roundtrip=0;shape=None
    if a['polygons']:
        shape=MultiPolygon([Polygon(p[0],p[1:]) for p in a['polygons']])
        if not shape.is_valid:issues.append('Invalid polygon topology: '+explain_validity(shape))
        radius=min((r['diameter'] or 750)/2/3396.19,1)
        reach=1.05 if r['group']=='valley' else 1.3 if r['group']=='crater' else 1.5
        crop=min(radius*reach,1.25)
        lat,lon=map(math.radians,[r['lat'],r['lon']])
        normal=np.array([math.cos(lat)*math.cos(lon),math.sin(lat),-math.cos(lat)*math.sin(lon)])
        north=np.array([-math.sin(lat)*math.cos(lon),math.cos(lat),math.sin(lat)*math.sin(lon)])
        east=np.cross(north,normal)
        for polygon in a['polygons']:
            for ring in polygon:
                pts=np.array(ring,dtype=float)
                if len(pts)<4 or not np.isfinite(pts).all() or not np.array_equal(pts[0],pts[-1]):issues.append('Non-finite or open ring');continue
                if pts.min()<0 or pts.max()>a['n']:issues.append('Coordinates outside mask')
                uv=(pts/a['n']*2-1)*a['s'];rho=(uv*uv).sum(axis=1)
                if rho.max()>=1:issues.append('Polygon exceeds its valid spherical projection');continue
                world=normal[None,:]*np.sqrt(1-rho)[:,None]+uv[:,0,None]*east+uv[:,1,None]*north
                back=np.column_stack((world@east,world@north))/a['s']*.5+.5
                roundtrip=max(roundtrip,float(np.abs(back*a['n']-pts).max()))
                mid=(pts[1:]+pts[:-1])/2;length=np.linalg.norm(np.diff(pts,axis=0),axis=1)
                angles=np.arcsin(np.minimum(np.linalg.norm((mid/a['n']*2-1)*a['s'],axis=1),.999999))
                near+=float(length[angles>crop*.975].sum());total+=float(length.sum())
        if roundtrip>1e-6:issues.append('Spherical projection round-trip mismatch')
        fraction=near/max(total,1e-9)
        if fraction>.2:issues.append('Contour follows the extraction crop instead of a resolved landform edge')
        if r['group']=='crater' and shape.distance(Point(a['n']/2,a['n']/2))>a['n']*.1:issues.append('Crater contour is displaced from its named location')
    else:fraction=0
    if args.apply and issues:
        a.update(method='unresolved',polygons=[],km2=None,min=None,max=None,reason='; '.join(issues)+'.')
    if args.apply and not a['polygons'] and r['id'] in previous:
        a['reason']='The previous contour followed the extraction edge. Re-analysis did not resolve a reliable physical boundary.'
    status='geometry-checked' if a['polygons'] and not issues else 'unresolved' if not a['polygons'] else 'failed'
    item=dict(id=r['id'],name=r['name'],status=status,method=a['method'],issues=issues,reviewedCropArtifact=r['id'] in previous,cropEdgeFraction=round(fraction,5),projectionErrorPixels=round(roundtrip,10),independentlyValidated=False)
    if args.apply:a['audit']=dict(status=status,date='2026-11-15',physicalBoundaryVerified=False)
    records.append(item)
summary=dict(total=len(records),statuses=dict(Counter(x['status'] for x in records)),methods=dict(Counter(x['method'] for x in records)),recomputedCandidates=len(previous)+1,scope='Topology, finite geometry, projection round trip, known crop edge artifacts, crater centre alignment. Not independent geological validation.')
payload=dict(date='2026-11-15',summary=summary,records=records)
(root/'data/boundary-audit.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2))
if args.apply:
    path.write_text('// IAU / USGS catalogue. Approximate derived contours; unresolved boundaries are withheld.\nwindow.MARS_REGIONS = '+json.dumps(regions,ensure_ascii=False,separators=(',',':'))+';\n')
print(json.dumps(summary,indent=2));assert not any(x['status']=='failed' for x in records)
