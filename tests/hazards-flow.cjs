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
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setOfflineMode(true);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text().slice(0, 300));
    });
    const input = async (id, value) =>
      page.$eval(
        "#" + id,
        (e, v) => {
          e.value = v;
          e.dispatchEvent(new Event("input", { bubbles: true }));
          e.dispatchEvent(new Event("change", { bubbles: true }));
        },
        value,
      );
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForSelector("body.ready");
    assert.equal(
      await page.$$eval("#planet-layer optgroup option", (e) => e.length),
      6,
    );
    assert.equal(await page.evaluate(() => __globe.areaMesh.visible), false);
    await page.click("#mode-routes");
    await page.click("#plan-global");
    await page.waitForFunction(
      () => __globalPlanner.state.result?.routes.length > 0,
    );
    await page.click("#hazards-open");
    await page.click("#hazard-clear");
    await page.select("#hazard-kind", "sand");
    await page.click("#hazard-on-route");
    await page.click("#hazard-apply");
    assert.equal(await page.$eval("#planet-layer", (e) => e.value), "hazards");
    assert(
      await page.evaluate(
        () => !__globalPlanner.state.result.routes[0].feasible,
      ),
    );
    assert(
      await page.evaluate(
        () =>
          __globalPlanner.state.result.routes.find(
            (r) => r.id === __globalPlanner.state.result.recommendedId,
          )?.feasible,
      ),
    );
    await page.evaluate(
      () =>
        (window.hazardFieldBefore = __globe.engine.getScenario(
          __globalPlanner.options(),
        )),
    );
    await page.mouse.move(700, 450);
    await page.mouse.down();
    await page.mouse.move(830, 480, { steps: 8 });
    await page.mouse.up();
    assert(
      await page.evaluate(
        () =>
          window.hazardFieldBefore ===
          __globe.engine.getScenario(__globalPlanner.options()),
      ),
    );
    await page.screenshot({
      path: path.resolve(__dirname, "hazards-global-preview.png"),
    });
    for (const layer of [
      "sand",
      "rocks",
      "rockfall",
      "cold",
      "solar",
      "hazards",
    ]) {
      await page.select("#planet-layer", layer);
      assert(
        (await page.$eval("#global-legend", (e) => e.textContent)).includes(
          "SIMULATED",
        ),
      );
    }
    await page.click("#hazards-open");
    await input("hazard-solar", 0.9);
    await page.click("#hazard-apply");
    assert.equal(
      await page.evaluate(() => __globalPlanner.state.result.recommendedId),
      null,
    );
    assert(await page.$eval("#follow-global", (e) => e.disabled));
    assert(
      (await page.$eval("#global-summary", (e) => e.textContent)).includes(
        "shelter",
      ),
    );
    await page.click("#hazards-open");
    await page.click("#hazard-enabled");
    await page.click("#hazard-apply");
    assert(
      await page.evaluate(() => !!__globalPlanner.state.result.recommendedId),
    );
    await page.click("#hazards-open");
    await page.click("#hazard-clear");
    await page.click("#hazard-enabled");
    await page.click("#hazard-generate");
    await input("hazard-seed", 123);
    await page.click("#hazard-apply");
    assert.equal(
      await page.evaluate(() => __globalPlanner.state.hazards.seed),
      123,
    );
    await page.click("#hazards-open");
    await page.click("#hazard-clear");
    await page.click("#hazard-apply");
    await page.click('.project-nav a[href^="valles.html"]');
    await page.waitForFunction(
      () => window.__valles?.state.evaluations.length > 0,
    );
    assert.equal(await page.evaluate(() => __valles.state.hazards.seed), 123);
    await page.click('[data-preset="clear"]');
    await page.click("#save-scenario");
    await page.click("#hazards-open");
    await page.click("#hazard-on-route");
    await page.click("#hazard-apply");
    assert.equal(await page.evaluate(() => __valles.state.layer), "hazards");
    assert(await page.evaluate(() => !!__valles.terrain3d));
    assert(
      await page.evaluate(
        () =>
          __valles.state.evaluations.find((r) => r.id === "direct").hazardMask >
          0,
      ),
    );
    assert(
      await page.evaluate(
        () =>
          !__valles.state.recommended ||
          __valles.state.recommended.points.every(
            (p) => !__valles.state.field.cells[p.index].hazardMask,
          ),
      ),
    );
    await page.click("#focus-route");
    await page.screenshot({
      path: path.resolve(__dirname, "hazards-local-preview.png"),
    });
    for (const layer of [
      "sand",
      "rocks",
      "rockfall",
      "cold",
      "solar",
      "hazards",
    ])
      await page.select("#local-hazard-layer", layer);
    await page.click("#view-2d");
    await page.click("#view-3d");
    await page.click("#hazards-open");
    await input("hazard-solar", 0.9);
    await page.click("#hazard-apply");
    assert.equal(await page.evaluate(() => __valles.state.recommended), null);
    assert(await page.$eval("#start-demo", (e) => e.disabled));
    assert(
      (await page.$eval("#hazard-status", (e) => e.textContent)).includes(
        "shelter",
      ),
    );
    await page.click("#restore-scenario");
    assert.equal(await page.evaluate(() => __valles.state.hazards.solar), 0);
    assert.equal(
      await page.evaluate(() => __valles.state.hazards.localFocus),
      null,
    );
    await page.evaluate(() => {
      const old = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        if (blob.type === "application/json") window.exportedHazardBlob = blob;
        return old.call(this, blob);
      };
    });
    await page.click("#export-plan");
    const exported = await page.evaluate(async () =>
      JSON.parse(await window.exportedHazardBlob.text()),
    );
    assert.equal(exported.hazardScenario.seed, 123);
    assert("rockfall" in exported.hazardPeaks);
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.click("#hazards-open");
    assert(await page.$eval("#hazard-dialog", (e) => e.open));
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.resolve(__dirname, "hazards-mobile-preview.png"),
    });
    await page.click("#hazard-close");
    await page.reload();
    await page.waitForFunction(
      () => window.__valles?.state.evaluations.length > 0,
    );
    assert.equal(await page.evaluate(() => __valles.state.hazards.seed), 123);
    assert.deepEqual(errors, []);
    console.log(
      "PASS hazard layers, manual/random/seed controls, route closure and detour, global solar hold, disabled fields, cached drag, local 3D/2D, comparison restore, export, handoff, mobile, offline reload",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
