// Full-catalogue geometry construction using the actual active selection layer.
const puppeteer = require(process.env.PUPPETEER_MODULE || "puppeteer-core");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
(async () => {
  const browser = await puppeteer.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-background-networking",
    ],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: 1280, height: 900 });
    await page.setOfflineMode(true);
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForSelector("body.ready");
    const result = await page.evaluate(async () => {
      const g = __globe,
        selection = g.selectionLayer,
        failures = [];
      let visible = 0,
        unresolved = 0;
      for (let i = 0; i < g.regions.length; i++) {
        const r = g.regions[i];
        selection.select(r);
        selection.update(performance.now() + 1000);
        if (r.area.polygons.length) {
          visible++;
          const attr = selection.mesh.geometry.attributes.position;
          if (
            !selection.mesh.visible ||
            !attr?.count ||
            !attr.array.every(Number.isFinite)
          )
            failures.push(r.name + ": empty/invalid selected geometry");
          if (
            selection.material.uniforms.centre.value.distanceTo(r._normal) >
            1e-8
          )
            failures.push(r.name + ": selection centre mismatch");
          if (selection.material.uniforms.span.value !== r.area.s)
            failures.push(r.name + ": projection scale mismatch");
        } else {
          unresolved++;
          if (selection.mesh.visible)
            failures.push(r.name + ": invented unresolved boundary");
        }
        if (i % 100 === 0)
          await new Promise((resolve) => setTimeout(resolve, 0));
      }
      selection.select(null);
      return {
        visible,
        unresolved,
        failures,
        meshes: g.planet.children.filter((c) => c.name === "selected-landform")
          .length,
      };
    });
    assert.deepEqual(result.failures, []);
    assert.equal(result.visible + result.unresolved, 2054);
    assert.equal(result.meshes, 1);
    assert.deepEqual(errors, []);
    console.log(
      "PASS every named feature in active renderer:",
      JSON.stringify(result),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
