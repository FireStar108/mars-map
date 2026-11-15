"""Complete Wikipedia cards with crater-table entries and IAU-linked Wikimedia images.
Run after build_wikipedia.py, using Python with beautifulsoup4. Network cache and
throttling are shared with that builder. No whole-Mars imagery is downloaded.
"""
import concurrent.futures as futures
import hashlib,json,re,time,urllib.parse,urllib.request,urllib.error,threading
from pathlib import Path
from bs4 import BeautifulSoup
import build_wikipedia as base

ROOT=base.ROOT;OUT=base.OUT
image_lock=threading.Lock();next_image=0

def wikidata(kind):
    tail='?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .' if kind=='articles' else '?item wdt:P18 ?img .'
    variable='article' if kind=='articles' else 'img'
    query=f'SELECT ?gid ?{variable} WHERE {{ ?item wdt:P2824 ?gid ; wdt:P376 wd:Q111 . {tail} }}'
    url='https://query.wikidata.org/sparql?format=json&query='+urllib.parse.quote(query)
    path=ROOT/f'data/wikidata-{kind}.json';cached=Path(f'/tmp/mars-map-wikidata-{kind}.json')
    if path.exists():return json.loads(path.read_text())
    if cached.exists():data=json.loads(cached.read_text())
    else:
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':base.UA,'Accept':'application/sparql-results+json'}),timeout=60) as response:data=dict(queryUrl=url,data=json.load(response))
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2));return data

def download(pair):
    global next_image
    filename,url=pair;target=OUT/filename
    if target.exists() and target.stat().st_size>100:return filename,True
    for attempt in range(6):
        try:
            with image_lock:
                time.sleep(max(0,next_image-time.monotonic()));next_image=time.monotonic()+.7
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':base.UA}),timeout=40) as response:
                data=response.read(3_000_001);mime=response.headers.get('Content-Type','')
            if not mime.startswith('image/') or len(data)>3_000_000:raise ValueError('Invalid / oversized thumbnail')
            target.write_bytes(data);return filename,True
        except Exception as err:
            if attempt==5:return filename,str(err)
            delay=2**attempt
            if isinstance(err,urllib.error.HTTPError) and err.code==429:
                delay=max(10,float(err.headers.get('Retry-After','30')))
                with image_lock:next_image=max(next_image,time.monotonic()+delay)
            time.sleep(delay)

def main():
    manifest=json.loads((ROOT/'data/wikipedia-sources.json').read_text());records=manifest['records']
    regions={r['id']:r for r in base.REGIONS}
    for suffix in ['A–G','H–N','O–Z']:
        title='List of craters on Mars: '+suffix
        result=base.request(dict(action='parse',page=title,prop='text|revid'))['parse']
        soup=BeautifulSoup(result['text'],'html.parser')
        count=0
        for row in soup.select('tr[id]'):
            links=row.find_all('a',href=re.compile(r'planetarynames\.wr\.usgs\.gov/Feature/\d+'))
            if not links:continue
            rid=re.search(r'/Feature/(\d+)',links[-1]['href']).group(1)
            if rid not in regions or records[rid]['status']=='article':continue
            cells=row.find_all(['td','th'],recursive=False)
            if len(cells)<4 or regions[rid]['group']!='crater':continue
            diameter=base.clean(cells[2].get_text(' ',strip=True));year=base.clean(cells[3].get_text(' ',strip=True))
            if not re.fullmatch(r'\d+(?:\.\d+)?',diameter):continue
            name=base.clean(cells[0].get_text(' ',strip=True))
            extract=f'Wikipedia lists {name} as a crater on Mars with a diameter of {diameter} km.'
            if re.fullmatch(r'\d{4}',year):extract+=f' Its name was approved in {year}.'
            if len(cells)>=6:
                origin=base.clean(cells[-2].get_text(' ',strip=True))
                if origin and len(origin)<180:extract+=' Name origin: '+origin+'.'
            url='https://en.wikipedia.org/wiki/'+urllib.parse.quote(title.replace(' ','_'))+'#'+urllib.parse.quote(row['id'])
            records[rid]=dict(status='article',scope='table-entry',checked=base.DATE,title=name+' · Mars crater list',url=url,revision=result['revid'],revisionUrl='https://en.wikipedia.org/w/index.php?oldid='+str(result['revid'])+'#'+urllib.parse.quote(row['id']),extract=extract,textLicense='CC BY-SA 4.0',textLicenseUrl='https://creativecommons.org/licenses/by-sa/4.0/',match={'method':'Wikipedia table row + exact IAU feature ID'},image=None)
            count+=1
        print('Table entries',suffix,count,flush=True)
    linked=wikidata('articles');image_data=wikidata('images')
    # Some non-crater features have alternative article titles. Only an exact
    # IAU identifier + Mars parent establishes this context relationship.
    extra={}
    for row in linked['data']['results']['bindings']:
        rid=row['gid']['value'];url=row['article']['value']
        if rid in records and records[rid]['status']!='article':extra[rid]=urllib.parse.unquote(url.split('/wiki/')[-1]).replace('_',' ')
    pages={}
    for batch in base.batches(list(dict.fromkeys(extra.values())),20):pages.update(base.query_titles(batch,prop='info|pageprops|extracts',inprop='url',exintro=1,explaintext=1,exchars=650,exlimit=20))
    for rid,title in extra.items():
        p=pages.get(title)
        if not p or not p.get('extract') or 'disambiguation' in p.get('pageprops',{}) or p['title'].startswith('List of '):continue
        records[rid]=dict(status='article',scope='related-article',checked=base.DATE,title=p['title'],pageid=p['pageid'],revision=p['lastrevid'],url=p['canonicalurl'],revisionUrl='https://en.wikipedia.org/w/index.php?oldid='+str(p['lastrevid']),extract=base.clean(p['extract']),textLicense='CC BY-SA 4.0',textLicenseUrl='https://creativecommons.org/licenses/by-sa/4.0/',match={'method':'Wikidata P2824 IAU ID + Mars parent + English sitelink'},image=None)
    candidates={}
    for row in image_data['data']['results']['bindings']:
        rid=row['gid']['value']
        if rid not in records or records[rid].get('image'):continue
        file=urllib.parse.unquote(row['img']['value'].rsplit('/',1)[-1])
        # Do not use generic spacecraft portraits as photographs of landforms.
        if re.search(r'Mars[_ ]Global[_ ]Surveyor[_ ]?1|spacecraft|rover[_ ]portrait',file,re.I):continue
        candidates.setdefault(rid,file)
    overrides=json.loads((ROOT/'data/wikipedia-image-overrides.json').read_text())
    for rid,override in overrides.items():
        if rid in records:candidates[rid]=override['file']
    info={}
    for batch in base.batches(list(dict.fromkeys('File:'+f for f in candidates.values())),20):
        info.update(base.query_titles(batch,prop='imageinfo',iiprop='url|extmetadata',iiurlwidth=480))
    downloads={}
    for rid,file in candidates.items():
        item=info.get('File:'+file,{}).get('imageinfo',[{}])[0];meta=item.get('extmetadata',{})
        value=lambda k:base.clean(meta.get(k,{}).get('value',''))
        override=overrides.get(rid,{})
        license=override.get('license') or value('LicenseShortName');url=item.get('thumburl','').split('?')[0]
        if not url or not (override or re.search(r'public domain|\bPD\b|CC[ -]|GFDL',license,re.I)):continue
        ext=Path(urllib.parse.urlparse(url).path).suffix.lower()
        if ext not in ['.jpg','.jpeg','.png','.webp']:continue
        filename=hashlib.sha256(('File:'+file).encode()).hexdigest()[:16]+ext
        records[rid]['image']=dict(file=file,local='assets/wikipedia/'+filename,source=url,page=item.get('descriptionurl'),author=value('Artist') or value('Credit') or 'See image source',credit=value('Credit'),license=license,licenseUrl=value('LicenseUrl'),caption=value('ImageDescription'),match='Wikidata P2824 IAU ID + Mars parent + P18 image',scope='wikimedia')
        if override:
            records[rid]['image'].update(licenseUrl=override['licenseUrl'],scope='article',match='Manually checked Wikipedia lead image and Commons licensing section',licenseEvidence=override)
        downloads[filename]=url
    failed={}
    with futures.ThreadPoolExecutor(max_workers=3) as pool:
        for i,(filename,result) in enumerate(pool.map(download,downloads.items())):
            if result is not True:failed[filename]=result
            if i%60==0:print('Additional images',i+1,'/',len(downloads),flush=True)
    for record in records.values():
        image=record.get('image')
        if image and Path(image['local']).name in failed:record['imageError']=failed[Path(image['local']).name];record['image']=None
    summary=dict(total=len(records),articles=sum(r['status']=='article' for r in records.values()),images=sum(bool(r.get('image')) for r in records.values()),tableEntries=sum(r.get('scope')=='table-entry' for r in records.values()),checked=base.DATE)
    manifest.update(summary=summary,requests=sorted(set(manifest['requests'])|base.requests_used|{linked['queryUrl'],image_data['queryUrl']}),records=records)
    (ROOT/'data/wikipedia-sources.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    (OUT/'catalogue.js').write_text('// Wikipedia excerpts/summaries: CC BY-SA 4.0; individual image sources/licenses retained.\nwindow.MARS_WIKIPEDIA = '+json.dumps(dict(meta=summary,records=records),ensure_ascii=False,separators=(',',':'))+';\n')
    print('DONE expanded catalogue',summary,'image failures',len(failed),flush=True)

if __name__=='__main__':main()
