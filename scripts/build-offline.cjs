// Recreate file:// tile transport copies after cloning. No extra dependencies.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../assets/global/hrsc');
let count=0;
for(let z=0;z<=6;z++) for(const name of fs.readdirSync(path.join(root,String(z)))) {
  if(!name.endsWith('.webp'))continue;
  const [x,y]=name.slice(0,-5).split('_').map(Number);
  const binary=fs.readFileSync(path.join(root,String(z),name));
  const target=path.join(root,String(z),`${x}_${y}.js`);
  if(!fs.existsSync(target))fs.writeFileSync(target,`window.MarsTerrainTiles.receive(${z},${x},${y},"data:image/webp;base64,${binary.toString('base64')}");\n`);
  count++;
}
console.log(`Ready for file:// use: ${count} local relief tile transports`);
