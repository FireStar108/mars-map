const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
 const raw=fs.readFileSync('worker/index.js','utf8').replace('__ASSET_RELEASE__','test-release').replace('__ASSET_COUNT__','1').replace('__ASSET_BYTES__','5');
 const worker=(await import('data:text/javascript;base64,'+Buffer.from(raw).toString('base64'))).default;
 const records=new Map(),cache=new Map();
 const object=(key)=>{const r=records.get(key);if(!r)return null;return {...r,key,writeHttpMetadata(headers){for(const [key,value]of Object.entries(r.httpMetadata||{})){headers.set(key==='contentType'?'Content-Type':'Cache-Control',value);}}};};
 const env={MARS_UPLOAD_KEY:'a'.repeat(64),BUCKET:{
  async put(key,data,options={}){const body=typeof data==='string'?Buffer.from(data):data;records.set(key,{body,size:body.byteLength,httpEtag:'"test-etag"',...options});},
  async head(key){return object(key);},async get(key){return object(key);},
  async list(){return {objects:[...records].map(([key,r])=>({key,size:r.size})),truncated:false};},
 }};
 const namedCache={async match(req){return cache.get(req.url)?.clone();},async put(req,res){cache.set(req.url,res);}};
 global.caches={get default(){throw new Error('Default cache is unavailable in isolated Workers');},async open(){return namedCache;}};
 const ctx={waitUntil(p){p.catch(()=>{});}},base='https://example.com';
 const send=(route,body,key=env.MARS_UPLOAD_KEY)=>worker.fetch(new Request(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Mars-Upload-Key':key},body:JSON.stringify(body)}),env,ctx);
 const file={path:'index.html',sha256:crypto.createHash('sha256').update('hello').digest('hex'),data:Buffer.from('hello').toString('base64'),type:'text/html'};
 assert.equal((await send('/__publish/batch',{release:'test-release',files:[file]},'wrong')).status,404);
 assert.equal((await send('/__publish/batch',{release:'test-release',files:[{...file,path:'../secret'}]})).status,400);
 assert.equal((await send('/__publish/batch',{release:'test-release',files:[{...file,sha256:'f'.repeat(64)}]})).status,422);
 assert.equal((await send('/__publish/seal',{})).status,409);
 assert.equal((await send('/__publish/batch',{release:'test-release',files:[file]})).status,200);
 const page=await worker.fetch(new Request(base+'/'),env,ctx);assert.equal(await page.text(),'hello');assert.equal(page.headers.get('Content-Type'),'text/html');
 assert.equal((await worker.fetch(new Request(base+'/.git/config'),env,ctx)).status,404);
 assert.equal((await send('/__publish/seal',{})).status,200);
 assert.equal((await send('/__publish/batch',{release:'test-release',files:[file]})).status,409);
 delete env.MARS_UPLOAD_KEY;
 assert.equal((await send('/__publish/batch',{},'a'.repeat(64))).status,404);
 assert.equal((await worker.fetch(new Request(base+'/__health'),env,ctx)).status,200);
 records.set('test-release/css/test.css',{...records.get('test-release/index.html'),httpMetadata:{contentType:'text/css'}});
 const css=await worker.fetch(new Request(base+'/css/test.css'),env,ctx);assert.equal(await css.text(),'hello');assert.equal(css.headers.get('Content-Type'),'text/css');
 global.caches.open=async()=>{throw new Error('Cache unavailable');};
 assert.equal(await (await worker.fetch(new Request(base+'/css/test.css'),env,ctx)).text(),'hello');
 console.log('PASS: isolated named cache and storage fallback when caching is unavailable');
 console.log('PASS: scoped upload authentication, path validation, content checksums, completeness/seal, read-only serving and disabled upload');
})().catch(e=>{console.error(e);process.exitCode=1});
