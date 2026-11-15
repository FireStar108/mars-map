const puppeteer = require(process.env.PUPPETEER_MODULE || "puppeteer-core"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (
        m.type() === "error" ||
        (m.type() === "warn" &&
          /WebGL|texture/i.test(m.text()) &&
          !/GPU stall due to ReadPixels/.test(m.text()))
      )
        errors.push(m.text());
    });
    await page.setOfflineMode(!process.env.MARS_TEST_URL);
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(
      process.env.MARS_TEST_URL || pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForSelector("body.ready");
    await page.evaluate(() => __globe.setView(-10, -70, 1 + 500 / 3396.19));
    await page.waitForFunction(
      () =>
        __globe.terrainTiles.state.level >= 5 &&
        !__globe.terrainTiles.state.loading,
      { timeout: 30000 },
    );
    assert.equal(
      await page.evaluate(() => __globe.terrainTiles.state.error),
      null,
    );
    assert(
      await page.evaluate(
        () =>
          __globe.terrainTiles.state.tileCount > 0 &&
          __globe.terrainTiles.state.tileCount <= 32 &&
          __globe.terrainTiles.cacheSize <= 36,
      ),
    );
    const screenshot = await page.screenshot({
      path: path.resolve(__dirname, "hrsc-relief-preview.png"),
      encoding: "base64",
    });
    const visibleTerrain = await page.evaluate(async (screenshot) => {
      const image = new Image();
      image.src = "data:image/png;base64," + screenshot;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 1440;
      canvas.height = 1000;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(400, 200, 600, 600).data;
      let visible = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 90) visible++;
      return visible / (600 * 600);
    }, screenshot);
    assert(
      visibleTerrain > 0.85,
      "The high-resolution terrain must actually render, not only report loaded tiles",
    );
    console.log(
      "PASS: native-resolution HRSC tiles load offline at close zoom, bounded tile/cache budget",
    );
    async function dragAt(distance) {
      await page.evaluate(
        (distance) => __globe.setView(-10, -70, distance),
        distance,
      );
      await delay(150);
      const before = await page.evaluate(() =>
        __globe.camera.position.clone().normalize().toArray(),
      );
      const speed = await page.evaluate(() => __globe.rotationSensitivity);
      await page.mouse.move(700, 420);
      await page.mouse.down();
      await page.mouse.move(780, 420, { steps: 8 });
      await page.mouse.up();
      await delay(500);
      const angle = await page.evaluate(
        (before) =>
          __globe.camera.position
            .clone()
            .normalize()
            .angleTo(new THREE.Vector3(...before)),
        before,
      );
      return { angle, speed };
    }
    const far = await dragAt(3.4),
      near = await dragAt(1 + 500 / 3396.19);
    assert(
      near.speed < far.speed * 0.15 && near.angle < far.angle * 0.25,
      JSON.stringify({ far, near }),
    );
    console.log(
      "PASS: close drag angle",
      near.angle.toFixed(3),
      "vs distant",
      far.angle.toFixed(3),
    );
    await page.evaluate(() =>
      __globe.selectRegion(
        __globe.regions.find((r) => r.name === "Olympus Mons"),
      ),
    );
    await page.waitForFunction(() => MarsRegionRisk.report?.sampleCount > 1);
    assert.equal(await page.$eval("#region-panel-wiki", (e) => e.hidden), true);
    await page.evaluate(() => {
      const r = __globe.selectedRegion;
      __globalPlanner.setHazards({ enabled: false });
      dispatchEvent(
        new CustomEvent("mars-weather", {
          detail: MarsWeather.normalize({
            temperature: -35,
            wind: 40,
            visibility: 3000,
            severity: 1,
            radius: 2,
            lat: r.lat,
            lon: r.lon,
          }),
        }),
      );
    });
    const storm = await page.evaluate(() => {
      const r = MarsRegionRisk.report;
      const cell = __globe.engine.getScenario(__globalPlanner.options()).cells[
        r.peaks.dust.index
      ];
      return { report: r, cell };
    });
    assert(storm.report.closed > 0 && storm.report.wind >= 50);
    assert.equal(storm.report.peaks.dust.value, storm.cell.dust);
    assert.equal(storm.report.score, 100);
    assert(
      (await page.$eval('[data-hazard="dust"]', (e) => e.textContent)).includes(
        "Strongest sampled zone",
      ),
    );
    assert.equal(
      await page.evaluate(
        () =>
          MarsRegionRisk.direction({ lat: 0, lon: 179 }, { lat: 0, lon: -179 })
            .compass,
      ),
      "E",
    );
    await page.select("#planet-layer", "surface");
    await page.waitForFunction(() => __globe.regionCapture.captures > 0);
    await delay(300);
    await page.screenshot({
      path: path.resolve(__dirname, "region-risk-preview.png"),
    });
    await page.evaluate(() => {
      dispatchEvent(
        new CustomEvent("mars-weather", {
          detail: MarsWeather.normalize({
            temperature: -35,
            wind: 4,
            visibility: 3000,
            severity: 0,
          }),
        }),
      );
    });
    assert.equal(await page.evaluate(() => MarsRegionRisk.report.closed), 0);
    await page.evaluate(() =>
      __globalPlanner.setHazards({
        enabled: true,
        solar: 1,
        sand: 0,
        rocks: 0,
        rockfall: 0,
        cold: 0,
      }),
    );
    assert(
      await page.evaluate(
        () =>
          MarsRegionRisk.report.solar &&
          MarsRegionRisk.report.closed === MarsRegionRisk.report.sampleCount,
      ),
    );
    assert(
      (
        await page.$eval('[data-hazard="solar"]', (e) => e.textContent)
      ).includes("Whole area"),
    );
    console.log(
      "PASS: scenario changes update region risk; peaks match routing cells; directional dust and map-wide solar hold",
    );
    await page.click("#region-tab-wiki");
    await page.waitForFunction(
      () => document.querySelector("#region-wikipedia img")?.naturalWidth > 0,
    );
    assert.equal(await page.$eval("#region-panel-risk", (e) => e.hidden), true);
    await page.screenshot({
      path: path.resolve(__dirname, "region-two-tabs-preview.png"),
    });
    await page.focus("#region-tab-wiki");
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      await page.$eval("#region-tab-risk", (e) =>
        e.getAttribute("aria-selected"),
      ),
      "true",
    );
    await page.evaluate(() => __globalPlanner.setHazards({ enabled: false }));
    await page.select("#planet-layer", "surface");
    await page.setViewport({ width: 390, height: 844 });
    await delay(300);
    assert.equal(
      await page.$eval("#region-panel-risk", (e) => e.hidden),
      false,
    );
    await page.screenshot({
      path: path.resolve(__dirname, "region-risk-mobile-preview.png"),
    });
    await page.click("#region-close");
    await page.setViewport({ width: 1440, height: 1000 });
    for (const [lat, lon] of [
      [10, 179.8],
      [89, 40],
    ]) {
      const count = await page.evaluate(
        () => __globe.terrainTiles.state.requests,
      );
      await page.evaluate(
        ({ lat, lon }) => __globe.setView(lat, lon, 1 + 500 / 3396.19),
        { lat, lon },
      );
      await page.waitForFunction(
        (count) =>
          __globe.terrainTiles.state.requests > count &&
          !__globe.terrainTiles.state.loading,
        {},
        count,
      );
      assert.equal(
        await page.evaluate(() => __globe.terrainTiles.state.error),
        null,
      );
    }
    const count = await page.evaluate(
      () => __globe.terrainTiles.state.requests,
    );
    await delay(400);
    assert.equal(
      await page.evaluate(() => __globe.terrainTiles.state.requests),
      count,
    );
    await page.select("#planet-layer", "photo");
    assert.equal(
      await page.evaluate(() => __globe.terrainTiles.state.enabled),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: two accessible panes, local Wikipedia image, mobile, longitude seam/pole, idle tile cache, colour overview, no browser errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
