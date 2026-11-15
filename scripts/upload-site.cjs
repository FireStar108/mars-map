const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'outputs/asset-manifest.json'),'utf8'));
if(manifest.baseRelease)throw new Error('This build reuses a sealed base and includes changes in the Worker; deploy the archive without uploading assets.');
const checkpoint=path.join(root,'outputs',`uploaded-${manifest.release}.json`);
let secret='';
async function input(){
 if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');process.stdin.resume();
 console.log('Ready for upload configuration on stdin (hidden).');
 return new Promise((resolve,reject)=>{let text='';const receive=s=>{text+=s;if(!text.includes('\n'))return;
 process.stdin.removeListener('data',receive);if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();
 try{resolve(JSON.parse(text))}catch(e){reject(e)}
 };process.stdin.on('data',receive);});
}
(async()=>{
 const config=await input();secret=config.key;
 const origin=new URL(config.url).origin;
 if(!origin.startsWith('https://')||!/^[a-f0-9]{64}$/.test(secret))throw new Error('Expected HTTPS and scoped upload key');
 const completed=new Set(fs.existsSync(checkpoint)?JSON.parse(fs.readFileSync(checkpoint,'utf8')):[]);
 async function call(route,body){
  for(let attempt=0;attempt<5;attempt++){
   try{
    const response=await fetch(origin+route,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Mars-Upload-Key':secret},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
    if(response.ok)return response.json();
    if(response.status===429||response.status>=500){
     const retry=response.headers.get('Retry-After');
     const seconds=retry?(Number(retry)||Math.max(1,(Date.parse(retry)-Date.now())/1000)):2**attempt;
     await new Promise(r=>setTimeout(r,seconds*1000));continue;
    }
    throw new Error(`Upload HTTP ${response.status}: ${(await response.text()).slice(0,200)}`);
   }catch(error){if(attempt===4||/^Upload HTTP/.test(error.message))throw error;await new Promise(r=>setTimeout(r,1000*2**attempt));}
  }
  throw new Error('Upload retry budget exhausted');
 }
 const files=manifest.files.filter(f=>!completed.has(f.path));
 files.sort((a,b)=>Number(/^assets\/global\/hrsc\/[0-6]\//.test(a.path))-Number(/^assets\/global\/hrsc\/[0-6]\//.test(b.path))||a.path.localeCompare(b.path));
 const batches=[];let batch=[],size=0;
 for(const file of files){
  if(batch.length&&(batch.length>=20||size+file.size>2*1024*1024)){batches.push(batch);batch=[];size=0;}
  batch.push(file);size+=file.size;
 }
 if(batch.length)batches.push(batch);
 let next=0,done=0;
 const start=Date.now();
 const workers=Math.min(8,Math.max(1,Math.floor(Number(process.env.MARS_UPLOAD_CONCURRENCY)||4)));
 await Promise.all(Array.from({length:workers},async()=>{
  while(next<batches.length){const batch=batches[next++];
   const payload=batch.map(file=>({...file,data:fs.readFileSync(path.join(root,'outputs/site',file.path)).toString('base64')}));
   await call('/__publish/batch',{release:manifest.release,files:payload});
   for(const file of batch)completed.add(file.path);
   fs.writeFileSync(checkpoint,JSON.stringify([...completed]));
   done++;
   if(done%25===0||done===batches.length)console.log(`Uploaded ${completed.size}/${manifest.files.length} files · ${Math.round((Date.now()-start)/1000)}s`);
  }
 }));
 const sealed=await call('/__publish/seal',{});
 console.log(JSON.stringify({url:origin,release:manifest.release,...sealed}));
})().catch(e=>{console.error(e.message.split(secret||'NO_SECRET').join('[redacted]'));process.exitCode=1});
