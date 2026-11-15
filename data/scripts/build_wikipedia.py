"""Build an offline, attributed Wikipedia companion for the full Mars catalogue.
Run with Python 3. Network access is only to public Wikimedia endpoints.
Exact candidate titles + Mars identity/coordinates prevent terrestrial namesakes.
Raw request cache is outside the playable project; reruns reuse it.
"""
import concurrent.futures as futures
import hashlib
import html
import json
import math
import re
import time
import threading
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path('/tmp/mars-map-wikipedia-cache')
CACHE.mkdir(exist_ok=True)
OUT = ROOT / 'assets/wikipedia'
OUT.mkdir(exist_ok=True)
DATE = '2026-11-15'
UA = 'Codex/1.0 (https://openai.com/codex/; local Mars Map educational prototype; offline attribution retained)'
API = 'https://en.wikipedia.org/w/api.php'
REGIONS = json.loads((ROOT/'js/regions.js').read_text().split('window.MARS_REGIONS = ')[1].rstrip(';\n'))
requests_used = set()
request_lock = threading.Lock()
next_request = 0
request_interval = 1.5
image_lock = threading.Lock()
next_image = 0

def request(params):
    global next_request, request_interval
    url = API + '?' + urllib.parse.urlencode(dict(action='query',format='json',formatversion=2,maxlag=5) | params)
    requests_used.add(url)
    path = CACHE/(hashlib.sha256(url.encode()).hexdigest()+'.json')
    if path.exists(): return json.loads(path.read_text())
    for attempt in range(7):
        try:
            with request_lock:
                time.sleep(max(0,next_request-time.monotonic()))
                next_request=time.monotonic()+request_interval
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=40) as response:
                data=json.load(response)
            if 'error' in data: raise RuntimeError(str(data['error']))
            path.write_text(json.dumps(data))
            time.sleep(.1)
            return data
        except Exception as err:
            if attempt==6: raise
            delay=2**attempt
            if isinstance(err,urllib.error.HTTPError) and err.code==429:
                delay=max(30,float(err.headers.get('Retry-After','30')))
                with request_lock:
                    next_request=max(next_request,time.monotonic()+delay)
                    request_interval=min(10,request_interval*1.5)
                print('Wikimedia rate limit; respecting retry delay',delay,flush=True)
            time.sleep(delay)

def batches(items, size=50):
    return [items[i:i+size] for i in range(0,len(items),size)]

def query_titles(titles, **params):
    result=request(dict(titles='|'.join(titles),redirects=1,**params))
    query=result.get('query',{})
    by_title={p['title']:p for p in query.get('pages',[])}
    redirects={r['from']:r['to'] for key in ['normalized','redirects'] for r in query.get(key,[])}
    output={}
    for title in titles:
        target=title
        for _ in range(5):
            if target not in redirects: break
            target=redirects[target]
        p=by_title.get(target)
        if p and (not p.get('missing') or p.get('imageinfo')) and not p.get('invalid'): output[title]=p
    return output

def candidates(r):
    n=r['name']
    if r['group']=='crater': return [n+' (Martian crater)',n+' (crater)',n+' (Mars crater)',n+' (Mars)',n]
    return [n,n+' (Mars)',n+' (Martian feature)']

def distance(r,c):
    lat1,lat2=map(math.radians,[r['lat'],c['lat']]); dlon=math.radians(c['lon']-r['lon'])
    return math.degrees(math.acos(max(-1,min(1,math.sin(lat1)*math.sin(lat2)+math.cos(lat1)*math.cos(lat2)*math.cos(dlon)))))

def match(r,p):
    if p.get('ns')!=0 or 'disambiguation' in p.get('pageprops',{}): return None
    title=re.sub(r'\s*\([^)]*\)\s*$','',p['title']).casefold()
    if title != r['name'].casefold(): return None
    coords=p.get('coordinates',[])
    mars=[c for c in coords if c.get('globe')=='mars']
    if mars:
        error=min(distance(r,c) for c in mars)
        tolerance=max(.6,(r.get('diameter') or 750)/3396.19*180/math.pi*.7)
        if error>tolerance:return None
        return {'method':'exact title + Mars coordinates','coordinateOffsetDegrees':round(error,4)}
    if coords: return None
    description=p.get('pageprops',{}).get('wikibase-shortdesc','')
    if re.search(r'\b(Mars|Martian)\b',description,re.I):return {'method':'exact title + Mars article description'}
    # Last-resort identity evidence comes from article extract, fetched below.
    return {'method':'pending article identity'}

def clean(s):
    return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',s or ''))).strip()

def main():
    titles=list(dict.fromkeys(t for r in REGIONS for t in candidates(r)))
    pages={}
    chunks=batches(titles)
    def get(chunk):return query_titles(chunk,prop='info|pageprops|coordinates|pageimages',inprop='url',piprop='name|thumbnail',pithumbsize=480,pilicense='free',coprimary='primary')
    with futures.ThreadPoolExecutor(max_workers=3) as pool:
        for i,found in enumerate(pool.map(get,chunks)):
            pages.update(found)
            if i%15==0:print('Candidate batches',i+1,'/',len(chunks),flush=True)
    matches={}
    for r in REGIONS:
        accepted=[]
        for title in candidates(r):
            p=pages.get(title)
            if p:
                evidence=match(r,p)
                if evidence:accepted.append((p,evidence))
        if accepted:
            accepted.sort(key=lambda pair:pair[1]['method']=='pending article identity')
            matches[r['id']]=accepted[0]
    pageids=list(dict.fromkeys(str(p['pageid']) for p,e in matches.values()))
    extracts={}
    def get_extract(ids):return request(dict(pageids='|'.join(ids),prop='extracts',exintro=1,explaintext=1,exchars=650,exlimit=20))
    with futures.ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(get_extract,batches(pageids,20)):
            for p in result.get('query',{}).get('pages',[]):extracts[p['pageid']]=p.get('extract','')
    for rid,(p,e) in list(matches.items()):
        text=extracts.get(p['pageid'],'')
        if not text or (e['method']=='pending article identity' and not re.search(r'\b(Mars|Martian)\b',text,re.I)):
            del matches[rid]
        elif e['method']=='pending article identity':e['method']='exact title + Mars lead paragraph'
    print('Matched articles',len(matches),'/',len(REGIONS),flush=True)
    files=list(dict.fromkeys('File:'+p['pageimage'] for p,e in matches.values() if p.get('pageimage')))
    images={}
    def get_image(chunk):return query_titles(chunk,prop='imageinfo',iiprop='url|extmetadata',iiurlwidth=480)
    with futures.ThreadPoolExecutor(max_workers=3) as pool:
        for found in pool.map(get_image,batches(files,20)):images.update(found)

    records={}; downloads={}
    for r in REGIONS:
        rid=r['id']
        record={'status':'not-found','checked':DATE}
        if rid in matches:
            p,e=matches[rid]
            text=clean(extracts[p['pageid']]).replace('(; ', '(')
            record=dict(status='article',checked=DATE,title=p['title'],pageid=p['pageid'],revision=p['lastrevid'],url=p['canonicalurl'],revisionUrl='https://en.wikipedia.org/w/index.php?oldid='+str(p['lastrevid']),extract=text,textLicense='CC BY-SA 4.0',textLicenseUrl='https://creativecommons.org/licenses/by-sa/4.0/',match=e,image=None)
            file='File:'+p.get('pageimage','')
            info=images.get(file,{}).get('imageinfo',[{}])[0]
            meta=info.get('extmetadata',{})
            value=lambda key: clean(meta.get(key,{}).get('value',''))
            license=value('LicenseShortName')
            image_url=info.get('thumburl') or p.get('thumbnail',{}).get('source')
            if image_url and re.search(r'public domain|\bPD\b|CC[ -]|GFDL',license,re.I):
                image_url=image_url.split('?')[0]
                extension=Path(urllib.parse.urlparse(image_url).path).suffix.lower()
                if extension in ['.jpg','.jpeg','.png','.webp']:
                    filename=hashlib.sha256(file.encode()).hexdigest()[:16]+extension
                    record['image']=dict(file=p['pageimage'],local='assets/wikipedia/'+filename,source=image_url,page=info.get('descriptionurl','https://commons.wikimedia.org/wiki/'+urllib.parse.quote(file.replace(' ','_'))),author=value('Artist') or value('Credit') or 'See image source',credit=value('Credit'),license=license,licenseUrl=value('LicenseUrl'),caption=value('ImageDescription'))
                    downloads[filename]=image_url
        records[rid]=record
    def download(pair):
        global next_image
        filename,url=pair; target=OUT/filename
        if target.exists() and target.stat().st_size>100:return filename,True
        for attempt in range(6):
            try:
                with image_lock:
                    time.sleep(max(0,next_image-time.monotonic()))
                    next_image=time.monotonic()+.65
                with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=35) as response:
                    data=response.read(3_000_001)
                    mime=response.headers.get('Content-Type','')
                if not mime.startswith('image/') or len(data)>3_000_000:raise ValueError('Invalid or oversized thumbnail')
                target.write_bytes(data);time.sleep(.1);return filename,True
            except Exception as err:
                if attempt==5:return filename,str(err)
                delay=2**attempt
                if isinstance(err,urllib.error.HTTPError) and err.code==429:
                    delay=max(10,float(err.headers.get('Retry-After','30')))
                    with image_lock:next_image=max(next_image,time.monotonic()+delay)
                time.sleep(delay)
    failed={}
    with futures.ThreadPoolExecutor(max_workers=3) as pool:
        for i,(filename,result) in enumerate(pool.map(download,downloads.items())):
            if result is not True:failed[filename]=result
            if i%60==0:print('Images',i+1,'/',len(downloads),flush=True)
    for record in records.values():
        photo=record.get('image')
        if photo and Path(photo['local']).name in failed:
            record['imageError']=failed[Path(photo['local']).name];record['image']=None
    summary=dict(total=len(records),articles=sum(r['status']=='article' for r in records.values()),images=sum(bool(r.get('image')) for r in records.values()),checked=DATE)
    payload=dict(meta=summary,records=records)
    (OUT/'catalogue.js').write_text('// Wikipedia excerpts: CC BY-SA 4.0; image licenses and source revisions in each record.\nwindow.MARS_WIKIPEDIA = '+json.dumps(payload,ensure_ascii=False,separators=(',',':'))+';\n')
    (ROOT/'data/wikipedia-sources.json').write_text(json.dumps(dict(summary=summary,requests=sorted(requests_used),records=records),ensure_ascii=False,indent=2))
    print('DONE',summary,'download failures',len(failed),flush=True)

if __name__=='__main__': main()
