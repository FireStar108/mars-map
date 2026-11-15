// Exercise real Three.js geometry generation without browser or WebGL.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),context={window:{},console};
for(const file of ['vendor/three-0.169.0.bundle.js','js/regions.js','js/nomenclature-layer.js'])vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),context);
const {THREE,MARS_REGIONS:regions,MarsNomenclatureLayer}=context.window;
const groups=Object.fromEntries(['mons','crater','low','plat','valley','mare','other'].map(key=>[key,{color:'#b9e9c8'}]));
function positionAt(lat,lon){const la=lat*Math.PI/180,lo=lon*Math.PI/180;return new THREE.Vector3(Math.cos(la)*Math.cos(lo),Math.sin(la),-Math.cos(la)*Math.sin(lo));}
for(const r of regions){r._normal=positionAt(r.lat,r.lon);r._north=new THREE.Vector3(0,1,0).addScaledVector(r._normal,-r._normal.y).normalize();r._east=new THREE.Vector3().crossVectors(r._north,r._normal).normalize();}
const planet=new THREE.Group();const layer=MarsNomenclatureLayer.create({THREE,regions,groups,planet,positionAt});
const resolved=regions.filter(r=>r.area.polygons.length);
assert.equal(layer.featureCount,resolved.length);assert(layer.featureCount>1200);assert.equal(layer.meshes.size,7);
assert.equal(layer.segmentCount,[...layer.meshes.values()].reduce((n,m)=>n+m.geometry.attributes.position.count/2,0));
for(const mesh of layer.meshes.values()){
 const positions=mesh.geometry.attributes.position.array;assert(positions.every(Number.isFinite));
 for(let i=0;i<positions.length;i+=3)assert(Math.abs(Math.hypot(positions[i],positions[i+1],positions[i+2])-1)<1e-5);
}
layer.setVisible(false,new Set(Object.keys(groups)));assert([...layer.meshes.values()].every(m=>!m.visible));
layer.setVisible(true,new Set(['crater']));assert([...layer.meshes.entries()].every(([key,m])=>m.visible===(key==='crater')));
console.log(`PASS: ${regions.length} names; ${resolved.length} surface outlines; ${layer.segmentCount} connected segments in 7 batches; filtering, finite positions and sphere alignment`);
