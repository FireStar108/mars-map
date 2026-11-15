const puppeteer = require(process.env.PUPPETEER_MODULE || "puppeteer-core"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
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
    const page = await browser.newPage(),
      errors = [];
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.setOfflineMode(true);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForSelector("body.ready");
    assert.equal(await page.evaluate(() => __globe.areaMesh.visible), false);
    assert.equal(
      await page.$$eval("#region-filters input:checked", (a) => a.length),
      7,
    );
    assert.equal(
      await page.evaluate(
        () => __globe.planet.children.filter((c) => c.isLineSegments).length,
      ),
      0,
    );
    await page.evaluate(() => __globe.setView(18, -133, 2));
    await delay(300);
    const point = await page.evaluate(() => {
      const p = __globe.positionAt(17, -136.5).project(__globe.camera);
      return {
        x: (p.x * 0.5 + 0.5) * innerWidth,
        y: (-0.5 * p.y + 0.5) * innerHeight,
      };
    });
    await page.mouse.move(point.x, point.y);
    await delay(120);
    assert.equal(
      await page.evaluate(() => __globe.areaMesh.visible),
      false,
      "Hover must never draw a boundary",
    );
    await page.mouse.click(point.x, point.y);
    assert.equal(
      await page.evaluate(() => __globe.selectedRegion.name),
      "Olympus Mons",
    );
    assert.equal(
      await page.evaluate(() => __globe.selectionLayer.resolution),
      2048,
    );
    // Freeze a deterministic partial reveal: a busy software renderer can
    // complete the short live animation before the next DevTools round trip.
    await page.evaluate(() => {
      const s = __globe.selectionLayer;
      window.restoreSelectionTick = s.update;
      s.update = () => false;
      s.material.uniforms.progress.value = 0.42;
      __globe.markDirty();
    });
    await delay(120);
    await page.screenshot({
      path: path.resolve(__dirname, "selection-reveal-preview.png"),
    });
    await page.evaluate(() => {
      __globe.selectionLayer.update = window.restoreSelectionTick;
      __globe.selectionLayer.material.uniforms.progress.value = 1;
      __globe.markDirty();
    });
    await delay(120);
    assert.equal(await page.evaluate(() => __globe.selectionLayer.progress), 1);
    await page.waitForFunction(() => __globe.regionCapture.captures === 1);
    await delay(350);
    assert(
      await page.evaluate(() => __globe.camera.position.length() < 1.9),
      "Surface click must approach the region",
    );
    const box = await page.$eval(".capture-frame", (e) => {
      const r = e.getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
      };
    });
    assert(Math.abs(box.width - box.height) < 1, "Viewfinder must be square");
    assert(
      box.width > 100 && box.left > 310 && box.right < 1100,
      "Selected region must fit between panels",
    );
    assert.equal(await page.$eval("#region-capture", (e) => e.hidden), false);
    assert.equal(
      await page.$eval(".capture-state", (e) => e.textContent),
      "AREA ACQUIRED",
    );
    await page.screenshot({
      path: path.resolve(__dirname, "selection-complete-preview.png"),
    });
    await page.evaluate(() =>
      __globe.setView(18, -132, __globe.camera.position.length()),
    );
    await page.waitForFunction(
      (left) =>
        Math.abs(
          document.querySelector(".capture-frame").getBoundingClientRect()
            .left - left,
        ) > 2,
      {},
      box.left,
    );
    assert.equal(
      await page.evaluate(() => __globe.regionCapture.captures),
      1,
      "Moving the camera must track the frame without another snapshot",
    );
    const counts = await page.evaluate(() => {
      const g = __globe;
      g.selectRegion(g.regions.find((r) => r.name === "Valles Marineris"));
      return {
        n: g.planet.children.filter((c) => c.name === "selected-landform")
          .length,
        name: g.selectionLayer.selected.name,
      };
    });
    assert.equal(counts.n, 1);
    assert.equal(counts.name, "Valles Marineris");
    await page.waitForFunction(() => __globe.selectionLayer.progress === 1);
    await page.waitForFunction(() => __globe.regionCapture.captures === 2);
    await page.click('#region-filters input[value="valley"]');
    await page.waitForFunction(
      () => !__globe.groupPoints.get("valley").visible,
    );
    assert.equal(await page.evaluate(() => __globe.areaMesh.visible), false);
    assert.equal(await page.$eval("#region-capture", (e) => e.hidden), true);
    assert.equal(
      await page.evaluate(() => __globe.groupPoints.get("valley").visible),
      false,
    );
    assert.equal(await page.$eval("#region-card", (e) => e.hidden), true);
    assert(await page.$$eval("#region-list button", (a) => a.length < 2054));
    await page.click('#region-filters input[value="valley"]');
    await page.evaluate(() =>
      __globe.selectRegion(__globe.regions.find((r) => r.name === "Victoria")),
    );
    assert.equal(
      await page.evaluate(() => __globe.areaMesh.visible),
      false,
      "Unknown boundary must remain unknown",
    );
    await page.waitForFunction(() => __globe.regionCapture.captures === 3);
    assert(
      (await page.$eval(".capture-state", (e) => e.textContent)).includes(
        "BOUNDARY UNRESOLVED",
      ),
    );
    await page.click("#region-close");
    await page.evaluate(() => __globe.setView(15, 120, 3.4));
    await delay(100);
    await page.evaluate(() => {
      window.pickHits = 0;
      const old = THREE.Raycaster.prototype.intersectObject;
      THREE.Raycaster.prototype.intersectObject = function (...a) {
        window.pickHits++;
        return old.apply(this, a);
      };
      return 0;
    });
    await page.mouse.move(700, 450);
    await page.mouse.down();
    await page.mouse.move(900, 550, { steps: 16 });
    await page.mouse.up();
    await delay(100);
    assert.equal(
      await page.evaluate(() => __globe.areaMesh.visible),
      false,
      "Dragging must not select an object",
    );
    assert.equal(
      await page.evaluate(() => window.pickHits),
      0,
      "Dragging must not raycast planet triangles",
    );
    assert(
      await page.evaluate(
        () => __globe.renderer.info.render.triangles < 160000,
      ),
    );
    await page.setViewport({ width: 390, height: 844 });
    await delay(150);
    await page.evaluate(() =>
      __globe.selectRegion(
        __globe.regions.find((r) => r.name === "Olympus Mons"),
      ),
    );
    await page.waitForFunction(() => __globe.regionCapture.captures === 4);
    await delay(350);
    assert(
      await page.$eval(".capture-frame", (e) => {
        const b = e.getBoundingClientRect(),
          card = document.getElementById("region-card").getBoundingClientRect();
        return b.left >= 0 && b.right <= innerWidth && b.bottom < card.top;
      }),
      "Mobile frame must remain visible above the detail card",
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.resolve(__dirname, "selection-mobile-preview.png"),
    });
    await page.evaluate(() => {
      __globe.selectRegion(
        __globe.regions.find((r) => r.name === "Valles Marineris"),
      );
      __globe.selectRegion(
        __globe.regions.find((r) => r.name === "Hellas Planitia"),
      );
    });
    await page.waitForFunction(() => __globe.regionCapture.captures === 5);
    assert.equal(
      await page.$eval(".capture-name", (e) => e.textContent),
      "Hellas Planitia",
    );
    await page.evaluate(() => {
      __globe.selectRegion(
        __globe.regions.find((r) => r.name === "Olympus Mons"),
      );
      __globe.zoomBy(1.1);
    });
    await delay(1100);
    assert.equal(
      await page.evaluate(() => __globe.regionCapture.captures),
      5,
      "Manual zoom cancels a pending shutter",
    );
    await page.click("#region-close");
    assert.equal(await page.$eval("#region-capture", (e) => e.hidden), true);
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    await page.evaluate(() =>
      __globe.selectRegion(
        __globe.regions.find((r) => r.name === "Olympus Mons"),
      ),
    );
    await page.waitForFunction(() => __globe.regionCapture.captures === 6);
    assert.equal(
      await page.$eval(".capture-flash", (e) => e.getAnimations().length),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS click-only white radial selection, approach and square capture, one boundary, filters, unresolved shape, drag, mobile, replacement/cancellation, reduced motion, no WebGL errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
