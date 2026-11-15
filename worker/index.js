// Public, read-only file serving after a release is sealed. Upload credentials
// are supplied by Sites at runtime, never included in client assets or Git.
const RELEASE = "__ASSET_RELEASE__";
const EXPECTED_FILES = __ASSET_COUNT__;
const EXPECTED_BYTES = __ASSET_BYTES__;
const BASE_RELEASE = "__BASE_RELEASE__";
const INLINE_FILES = __INLINE_FILES__;
const REMOVED_FILES = __REMOVED_FILES__;
const prefix = RELEASE + "/";
const json = (body, status=200) => new Response(JSON.stringify(body), {status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
function validPath(key) {
  return typeof key === "string" && key.length < 400 && /^[a-zA-Z0-9_./-]+$/.test(key) &&
    !key.split("/").some(s=>!s || s==="." || s===".." || s.startsWith(".")) &&
    (/^(assets|css|js|vendor|data)\//.test(key) || /^[a-zA-Z0-9_-]+\.html$/.test(key) || key==="_headers");
}
function authorized(request, env) {
  const actual=request.headers.get("X-Mars-Upload-Key")||"", expected=env.MARS_UPLOAD_KEY||"";
  if(expected.length!==64 || actual.length!==expected.length)return false;
  let diff=0;for(let i=0;i<expected.length;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);
  return diff===0;
}
async function upload(request, env, url) {
  if(BASE_RELEASE)return new Response("Not found",{status:404});
  if(!authorized(request,env))return new Response("Not found",{status:404});
  if(await env.BUCKET.head(prefix+".sealed"))return json({error:"Release is sealed"},409);
  if(url.pathname==="/__publish/seal" && request.method==="POST") {
    let cursor, count=0, bytes=0;
    do {
      const page=await env.BUCKET.list({prefix,limit:1000,...(cursor?{cursor}:{})});
      for(const object of page.objects){count++;bytes+=object.size;}
      cursor=page.truncated?page.cursor:null;
    }while(cursor);
    if(count!==EXPECTED_FILES || bytes!==EXPECTED_BYTES)return json({error:"Incomplete release",count,bytes,expected:EXPECTED_FILES},409);
    await env.BUCKET.put(prefix+".sealed",JSON.stringify({count,bytes,sealedAt:new Date().toISOString()}));
    return json({sealed:true,count,bytes});
  }
  if(url.pathname!=="/__publish/batch" || request.method!=="POST")return new Response("Not found",{status:404});
  if(Number(request.headers.get("Content-Length"))>12*1024*1024)return json({error:"Batch too large"},413);
  let body;
  try {body=await request.json();}catch{return json({error:"Invalid batch"},400);}
  if(body.release!==RELEASE || !Array.isArray(body.files) || body.files.length<1 || body.files.length>20)return json({error:"Invalid release/batch"},400);
  let total=0;
  const files=[];
  for(const file of body.files) {
    if(!validPath(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)||typeof file.data!=="string"||file.data.length>8*1024*1024)return json({error:"Invalid file"},400);
    let bytes;
    try {bytes=Uint8Array.from(atob(file.data),c=>c.charCodeAt(0));}catch{return json({error:"Invalid encoding"},400);}
    total+=bytes.byteLength;
    if(total>8*1024*1024)return json({error:"Batch too large"},413);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
    if(digest!==file.sha256)return json({error:"Checksum mismatch"},422);
    files.push({...file,bytes});
  }
  await Promise.all(files.map(file=>env.BUCKET.put(prefix+file.path,file.bytes,{
    httpMetadata:{contentType:file.type,cacheControl:file.path.endsWith(".html")?"no-cache":"public, max-age=86400"},
    customMetadata:{sha256:file.sha256},
  })));
  return json({stored:files.map(f=>f.path)});
}
export default {
  async fetch(request, env, ctx) {
    if(!env.BUCKET)return json({error:"File storage not bound"},503);
    const url=new URL(request.url);
    if(url.pathname.startsWith("/__publish/"))return upload(request,env,url);
    if(url.pathname==="/__health")return json({release:RELEASE,baseRelease:BASE_RELEASE||null,sealed:!!await env.BUCKET.head((BASE_RELEASE||RELEASE)+"/.sealed"),files:EXPECTED_FILES,inlineFiles:Object.keys(INLINE_FILES).length});
    if(!["GET","HEAD"].includes(request.method))return new Response("Method not allowed",{status:405,headers:{Allow:"GET, HEAD"}});
    let key;
    try{key=decodeURIComponent(url.pathname).replace(/^\//,"")||"index.html";}catch{return new Response("Not found",{status:404});}
    if(!validPath(key)||REMOVED_FILES.includes(key))return new Response("Not found",{status:404});
    const cacheKey=new Request(url.origin+"/"+key+"?release="+RELEASE);
    const cacheable=request.method==="GET"&&!key.endsWith(".html");
    // Sites runs in an isolated Workers namespace: the shared default cache is
    // unavailable. A named cache is optional; storage must still work without it.
    let cache;
    if(cacheable){try{cache=await caches.open("mars-assets");const cached=await cache.match(cacheKey);if(cached)return cached;}catch{cache=null;}}
    const inline=INLINE_FILES[key];
    const object=inline?{
      body:request.method==="HEAD"?null:Uint8Array.from(atob(inline.data),c=>c.charCodeAt(0)),
      size:inline.size,httpEtag:`"${inline.sha256}"`,customMetadata:{sha256:inline.sha256},
      writeHttpMetadata(headers){headers.set("Content-Type",inline.type);headers.set("Cache-Control",key.endsWith(".html")?"no-cache":"public, max-age=86400");},
    }:await env.BUCKET[request.method==="HEAD"?"head":"get"]((BASE_RELEASE||RELEASE)+"/"+key);
    if(!object)return new Response("Not found",{status:404,headers:{"Cache-Control":"no-store"}});
    const headers=new Headers();object.writeHttpMetadata(headers);
    headers.set("ETag",object.httpEtag);
    headers.set("X-Content-SHA256",object.customMetadata?.sha256||"");
    headers.set("X-Content-Type-Options","nosniff");
    if(request.headers.get("If-None-Match")===object.httpEtag)return new Response(null,{status:304,headers});
    headers.set("Content-Length",String(object.size));
    const response=new Response(request.method==="HEAD"?null:object.body,{headers});
    if(cache)ctx.waitUntil(cache.put(cacheKey,response.clone()).catch(()=>{}));
    return response;
  }
};
