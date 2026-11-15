const fs=require('node:fs'), path=require('node:path');
const root=path.resolve(__dirname,'..'), dest=path.join(root,'dist');
fs.mkdirSync(dest,{recursive:true});
// Only runtime files and publicly attributed data enter the public site.
for(const entry of fs.readdirSync(root)) {
  if(!entry.endsWith('.html') && !['assets','css','js','vendor'].includes(entry))continue;
  fs.cpSync(path.join(root,entry),path.join(dest,entry),{recursive:true,filter:source=>{
    const relative=path.relative(root,source).split(path.sep).join('/');
    return !relative.endsWith('.DS_Store') && !/^assets\/global\/hrsc\/[0-6]\/.*\.js$/.test(relative);
  }});
}
fs.mkdirSync(path.join(dest,'data'),{recursive:true});
for(const file of ['boundary-audit.json','wikipedia-sources.json'])
  fs.copyFileSync(path.join(root,'data',file),path.join(dest,'data',file));
let count=0;
for(let z=0;z<=6;z++) {
  const entries=fs.readdirSync(path.join(dest,'assets/global/hrsc',String(z))).filter(x=>x.endsWith('.webp'));
  if(entries.length!==2*4**z)throw new Error(`Missing relief tiles at level ${z}`);
  count+=entries.length;
}
fs.writeFileSync(path.join(dest,'.nojekyll'),'');
fs.writeFileSync(path.join(dest,'_headers'),'/assets/global/hrsc/*\n  Cache-Control: public, max-age=86400\n');
console.log(`Built static site with ${count} full-dimension relief tiles in dist/`);
