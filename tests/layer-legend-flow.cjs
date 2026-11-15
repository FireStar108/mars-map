const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const assert = require('node:assert/strict'), path = require('node:path');
const { pathToFileURL } = require('node:url');
(async()=>{
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.setOfflineMode(!process.env.MARS_TEST_URL);
    await page.setViewport({width:1440,height:1000});
    await page.goto(process.env.MARS_TEST_URL || pathToFileURL(path.resolve(__dirname,'../index.html')).href);
    await page.waitForSelector('body.ready');
    const layers=await page.$$eval('#planet-layer option',es=>es.map(e=>e.value));
    for(const layer of layers){
      await page.select('#planet-layer',layer);
      await page.waitForFunction(layer=>document.querySelector('#global-legend').dataset.layer===layer,{},layer);
      assert((await page.$eval('#global-legend .legend-meaning',e=>e.textContent)).length>35,layer);
      assert(await page.$eval('#global-legend details',e=>e.open),layer);
    }
    await page.select('#planet-layer','radiation');
    const radiation=await page.$eval('#global-legend',e=>e.textContent);
    assert(radiation.includes('cyan is higher than dark blue'));
    assert(radiation.includes('1× is the reference at 0 km'));
    assert(radiation.includes('not a measured radiation dose'));
    assert.equal(await page.$$eval('#global-legend .legend-ticks span',es=>es.length),5);
    await page.screenshot({path:path.resolve(__dirname,'legend-radiation-preview.png')});
    await page.click('#global-legend summary');
    assert.equal(await page.$eval('#global-legend details',e=>e.open),false);
    await page.select('#planet-season','45');
    assert.equal(await page.$eval('#global-legend details',e=>e.open),false,'Keep manual collapse within one layer');
    await page.select('#planet-layer','cold');
    assert(await page.$eval('#global-legend details',e=>e.open),'Reopen explanation for the next layer');
    await page.evaluate(()=>__globalPlanner.setHazards({enabled:false}));
    assert((await page.$eval('#global-legend',e=>e.textContent)).includes('switched off'));
    await page.evaluate(()=>__globalPlanner.setHazards({enabled:true,solar:.8}));
    await page.select('#planet-layer','solar');
    assert((await page.$eval('#global-legend',e=>e.textContent)).includes('entire map'));
    await page.setViewport({width:390,height:844});
    await page.select('#planet-layer','radiation');
    await page.waitForFunction(()=>{const a=document.querySelector('#global-legend').getBoundingClientRect(),b=document.querySelector('.region-browser').getBoundingClientRect();return b.bottom<=a.top+1&&a.right<=innerWidth+1&&a.bottom<=innerHeight+1;}).catch(async e=>{console.log(await page.evaluate(()=>['#global-legend','.region-browser'].map(s=>({s,rect:document.querySelector(s).getBoundingClientRect().toJSON()}))));throw e;});
    await page.screenshot({path:path.resolve(__dirname,'legend-radiation-mobile-preview.png')});
    await page.setViewport({width:1440,height:1000});
    await page.click('.project-nav a[href="valles.html"]');
    await page.waitForFunction(()=>window.__valles?.state.evaluations.length>0);
    for(const layer of ['surface','slope','science','conditions','hazards']){
      await page.click(`[data-layer="${layer}"]`);
      assert((await page.$eval('#map-legend .legend-meaning',e=>e.textContent)).length>35,layer);
    }
    for(const layer of ['sand','rocks','rockfall','cold','solar']){
      await page.select('#local-hazard-layer',layer);
      assert.equal(await page.$eval('#map-legend',e=>e.dataset.layer),layer);
      assert.equal(await page.$$eval('#map-legend .legend-ticks span',es=>es.length),5);
    }
    await page.click('[data-layer="slope"]');
    assert((await page.$eval('#map-legend',e=>e.textContent)).includes('>28° · blocked'));
    assert(await page.evaluate(()=>document.querySelector('#map-legend').getBoundingClientRect().top>=document.querySelector('#map-shell').getBoundingClientRect().bottom));
    await page.screenshot({path:path.resolve(__dirname,'legend-valles-preview.png')});
    await page.setViewport({width:390,height:844});
    await page.$eval('#map-legend',e=>e.scrollIntoView({block:'center'}));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.resolve(__dirname,'legend-valles-mobile-preview.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS: all planet/local legends, radiation direction and units, hazard types and holds, disabled state, collapse/reopen, desktop/mobile layout, no browser errors');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
