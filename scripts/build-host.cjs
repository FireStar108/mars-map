const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),web=path.join(root,'outputs/site'),dist=path.join(root,'dist');
if(!fs.existsSync(web))throw new Error('Run build:web first');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.txt':'text/plain; charset=utf-8','.wasm':'application/wasm'};
const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else{
 const key=path.relative(web,p).split(path.sep).join('/');if(key.startsWith('.'))continue;
 const data=fs.readFileSync(p);files.push({path:key,size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),type:types[path.extname(key)]||'application/octet-stream'});
}}}
walk(web);files.sort((a,b)=>a.path.localeCompare(b.path));
const release='mars-'+crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,20);
const total=files.reduce((n,f)=>n+f.size,0);
const basePath=path.join(root,'.openai/static-base.json');
const base=fs.existsSync(basePath)?JSON.parse(fs.readFileSync(basePath,'utf8')):null;
const oldFiles=new Map((base?.files||[]).map(f=>[f.path,f]));
const inline={},removed=[];
let inlineBytes=0;
if(base){
 if(!/^mars-[a-f0-9]{20}$/.test(base.release))throw new Error('Invalid sealed asset base');
 for(const file of files){
  if(oldFiles.get(file.path)?.sha256===file.sha256)continue;
  inlineBytes+=file.size;
  if(inlineBytes>4*1024*1024)throw new Error('Changes exceed the 4 MiB inline budget; publish a new static base');
  inline[file.path]={...file,data:fs.readFileSync(path.join(web,file.path)).toString('base64')};
 }
 const current=new Set(files.map(f=>f.path));
 for(const file of base.files)if(!current.has(file.path))removed.push(file.path);
}
fs.writeFileSync(path.join(root,'outputs/asset-manifest.json'),JSON.stringify({release,total,files,baseRelease:base?.release||null,inlineCount:Object.keys(inline).length}));
fs.mkdirSync(path.join(dist,'server'),{recursive:true});
const template=fs.readFileSync(path.join(root,'worker/index.js'),'utf8');
fs.writeFileSync(path.join(dist,'server/index.js'),template.replace('__ASSET_RELEASE__',release).replace('__ASSET_COUNT__',String(files.length)).replace('__ASSET_BYTES__',String(total)).replace('__BASE_RELEASE__',base?.release||'').replace('__INLINE_FILES__',JSON.stringify(inline)).replace('__REMOVED_FILES__',JSON.stringify(removed)));
fs.mkdirSync(path.join(dist,'.openai'),{recursive:true});
fs.copyFileSync(path.join(root,'.openai/hosting.json'),path.join(dist,'.openai/hosting.json'));
console.log(`Worker ready; ${release}; ${files.length} files / ${total} bytes; ${Object.keys(inline).length} changed files (${inlineBytes} bytes) inline; base ${base?.release||'requires upload'}`);
