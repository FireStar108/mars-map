const puppeteer = require(process.env.PUPPETEER_MODULE || "puppeteer-core"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
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
      if (m.type() === "error") errors.push(m.text());
    });
    await page.setOfflineMode(true);
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForSelector("body.ready");
    for (const name of ["Olympus Mons", "Valles Marineris", "Gale", "Jezero"]) {
      await page.evaluate(
        (name) =>
          __globe.selectRegion(__globe.regions.find((r) => r.name === name)),
        name,
      );
      await page.click("#region-tab-wiki");
      await page.waitForFunction(
        () => document.querySelector("#region-wikipedia img")?.naturalWidth > 0,
      );
      assert(
        (await page.$eval("#region-description", (e) => e.textContent)).length >
          60,
      );
      assert(
        (
          await page.$eval("#region-text-source", (e) => e.textContent)
        ).includes("CC BY-SA"),
      );
      assert.equal(
        await page.$eval("#region-quality", (e) => e.dataset.status),
        "approximate",
      );
    }
    await page.evaluate(() =>
      __globe.selectRegion(__globe.regions.find((r) => r.name === "Airy")),
    );
    assert(
      (await page.$eval("#region-text-source", (e) => e.textContent)).includes(
        "Table-entry summary",
      ),
    );
    assert(
      (await page.$eval("#region-description", (e) => e.textContent)).includes(
        "crater on Mars",
      ),
    );
    await page.evaluate(() =>
      __globe.selectRegion(
        __globe.regions.find((r) => r.name === "Vastitas Borealis"),
      ),
    );
    assert.equal(await page.evaluate(() => __globe.areaMesh.visible), false);
    assert(
      (await page.$eval("#region-quality", (e) => e.textContent)).includes(
        "extraction edge",
      ),
    );
    await page.evaluate(() => {
      const r = __globe.regions.find(
        (r) =>
          MARS_WIKIPEDIA.records[r.id].status === "not-found" &&
          !MARS_WIKIPEDIA.records[r.id].image,
      );
      __globe.selectRegion(r);
    });
    assert.equal(
      await page.$eval("#region-wikipedia", (e) => e.dataset.status),
      "not-found",
    );
    assert(
      (await page.$eval("#region-text-source", (e) => e.textContent)).includes(
        "not a Wikipedia excerpt",
      ),
    );
    await page.evaluate(() =>
      __globe.selectRegion(
        __globe.regions.find((r) => r.name === "Olympus Mons"),
      ),
    );
    await page.click("#region-tab-wiki");
    await page.waitForFunction(
      () =>
        document.querySelector("#region-wikipedia img")?.naturalWidth > 0 &&
        !__globe.regionCapture.pending,
    );
    await page.screenshot({
      path: path.resolve(__dirname, "wikipedia-desktop-preview.png"),
    });
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() =>
      __globe.selectRegion(
        __globe.regions.find((r) => r.name === "Olympus Mons"),
      ),
    );
    await page.waitForFunction(() => !__globe.regionCapture.pending);
    await page.click("#region-tab-wiki");
    await page.$eval("#region-card", (e) => {
      e.scrollTop = 80;
    });
    await page.screenshot({
      path: path.resolve(__dirname, "wikipedia-mobile-preview.png"),
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS offline Wikipedia photos/text/credits, table identity, missing entries, withheld boundary, desktop/mobile, no browser errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
