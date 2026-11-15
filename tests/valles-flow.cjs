// Integration test for file:// or MARS_TEST_URL. Requires PUPPETEER_MODULE and Chrome.
const puppeteer = require(process.env.PUPPETEER_MODULE || "puppeteer-core"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath:
      process.env.CHROME_PATH ||
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
    await page.setOfflineMode(!process.env.MARS_TEST_URL);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text().slice(0, 300));
    });
    const url = process.env.MARS_TEST_URL || pathToFileURL(path.resolve(__dirname, "../index.html")).href;
    await page.goto(url);
    await page.waitForSelector("body.ready");
    assert.equal(
      await page.$$eval("#region-list button", (es) => es.length),
      2054,
    );
    assert.equal(
      await page.evaluate(
        () => __globe.regions.filter((r) => r.area.polygons.length).length,
      ),
      1503,
    );
    await page.click("#find-valles");
    await delay(1100);
    assert.equal(
      await page.$eval("#region-name", (e) => e.textContent),
      "Valles Marineris",
    );
    assert.equal(await page.$eval("#region-open", (e) => e.hidden), false);
    await page.click("#mode-routes");
    await page.click("#plan-global");
    await page.waitForFunction(
      () => __globalPlanner.state.result?.routes.length === 2,
    );
    await page.click("#save-global-scenario");
    const before = await page.evaluate(
      () =>
        __globalPlanner.state.result.routes.find((r) => r.id === "aware")
          .points,
    );
    await page.click("#weather-open");
    assert(await page.$eval("#weather-dialog", (e) => e.open));
    await page.click("#gw-route-storm");
    await page.click("#gw-apply");
    assert.equal(await page.$eval("#planet-layer", (e) => e.value), "scenario");
    assert.notDeepEqual(
      await page.evaluate(
        () =>
          __globalPlanner.state.result.routes.find((r) => r.id === "aware")
            .points,
      ),
      before,
    );
    assert(
      (await page.$eval("#global-comparison", (e) => e.textContent)).includes(
        "Against saved",
      ),
    );
    await page.screenshot({
      path: path.resolve(__dirname, "valles-global-preview.png"),
    });
    await page.click('.project-nav a[href^="valles.html"]');
    await page.waitForFunction(
      () => window.__valles?.state.evaluations.length === 2,
    );
    assert.equal(await page.evaluate(() => __valles.state.view), "3d");
    assert(await page.evaluate(() => !!__valles.terrain3d));
    assert.equal(
      await page.$eval(".workspace", (e) => getComputedStyle(e).display),
      "grid",
    );
    await page.click('[data-preset="clear"]');
    await page.click("#save-scenario");
    const clear = await page.evaluate(() => ({
      path: __valles.state.evaluations
        .find((r) => r.id === "gentle")
        .points.map((p) => p.index),
      total: __valles.state.evaluations[0].total,
    }));
    await page.click('[data-preset="dust"]');
    assert(
      (await page.evaluate(() => __valles.state.evaluations[0].total)) >
        clear.total,
    );
    assert.notDeepEqual(
      await page.evaluate(() =>
        __valles.state.evaluations
          .find((r) => r.id === "gentle")
          .points.map((p) => p.index),
      ),
      clear.path,
    );
    assert(
      (await page.$eval("#comparison", (e) => e.textContent)).includes(
        "Remaining",
      ),
    );
    await page.click("#restore-scenario");
    assert(
      Math.abs(
        (await page.evaluate(() => __valles.state.evaluations[0].total)) -
          clear.total,
      ) < 1e-8,
    );
    await page.click("#focus-route");
    await delay(700);
    await page.screenshot({
      path: path.resolve(__dirname, "valles-local-preview.png"),
    });
    for (const layer of ["slope", "science", "conditions", "surface"])
      await page.click(`[data-layer="${layer}"]`);
    await page.click("#view-2d");
    assert.equal(await page.$eval("#terrain-3d", (e) => e.hidden), true);
    await page.click("#view-3d");
    await page.click("#pick-target");
    const pt = await page.evaluate(() => {
      const v = __valles.terrain3d,
        d = __valles.data,
        t = d.targets.find((t) => t.id === "near");
      const p = v.scenePoint(t).project(v.camera),
        r = v.renderer.domElement.getBoundingClientRect();
      return {
        x: r.x + ((p.x + 1) * r.width) / 2,
        y: r.y + ((1 - p.y) * r.height) / 2,
      };
    });
    await page.mouse.click(pt.x, pt.y);
    await delay(500);
    assert.equal(
      await page.$eval("#target", (e) => e.value),
      "custom",
      "3D surface destination pick",
    );
    await page.select("#target", "ridge");
    await page.$eval("#limit", (e) => {
      e.value = 80;
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForSelector("#fallback button");
    await page.click("#fallback button");
    assert.equal(await page.$eval("#target", (e) => e.value), "near");
    await page.$eval("#temperature", (e) => {
      e.value = -120;
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => !__valles.state.recommended);
    assert(await page.$eval("#start-demo", (e) => e.disabled));
    await page.click("#random-weather");
    assert(
      await page.evaluate(() =>
        __valles.state.evaluations.every((r) => Number.isFinite(r.total)),
      ),
    );
    await page.click('[data-preset="clear"]');
    await page.$eval("#limit", (e) => {
      e.value = 180;
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await delay(300);
    await page.click("#sources-open");
    assert(await page.$eval("#sources", (e) => e.open));
    await page.click("#sources-close");
    await page.click("#start-demo");
    await delay(300);
    assert(await page.evaluate(() => !!__valles.state.demo));
    await page.click("#stop-demo");
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    await delay(300);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert(await page.$eval("#map", (e) => e.clientHeight > 300));
    await page.screenshot({
      path: path.resolve(__dirname, "valles-mobile-preview.png"),
    });
    await page.reload();
    await page.waitForFunction(
      () => window.__valles?.state.evaluations.length > 0,
    );
    await page.click('.section-nav a[href="index.html"]');
    await page.waitForSelector("body.ready");
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.click("#weather-open");
    assert(await page.$eval("#weather-dialog", (e) => e.open));
    await page.click("#weather-close");
    await page.click("#mode-missions");
    await page.select("#mission-select", "perseverance");
    await delay(300);
    assert.equal(
      await page.$eval("#c-name", (e) => e.textContent),
      "Perseverance",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS atlas → spatial global weather/routes → Valles 3D picking, replanning, comparison, holds, fallback, layers, preview, mobile and reload",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
