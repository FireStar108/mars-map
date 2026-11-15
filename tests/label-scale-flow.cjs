// Offline visual/interaction checks for zoom-dependent catalogue names.
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
    async function view(name, altitude, level) {
      await page.evaluate(
        async ({ name, altitude }) => {
          const r = __globe.regions.find((r) => r.name === name);
          __globe.setView(r.lat, r.lon, 1 + altitude / 3396.19);
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        },
        { name, altitude },
      );
      await page.waitForFunction(
        (level) => __globe.labelScale.index === level,
        {},
        level,
      );
      return page.evaluate(() => ({
        names: __globe.placedLabels.map((b) => ({
          name: b.r.name,
          diameter: b.r.diameter,
          group: b.r.group,
        })),
        status: document.querySelector("#label-scale-status").textContent,
      }));
    }
    async function checkLayout() {
      const boxes = await page.$$eval(".region-label", (nodes) =>
        nodes
          .filter((e) => e.style.display !== "none")
          .map((e) => {
            const b = e.getBoundingClientRect();
            return {
              name: e.textContent,
              left: b.left,
              right: b.right,
              top: b.top,
              bottom: b.bottom,
            };
          }),
      );
      for (let i = 0; i < boxes.length; i++) {
        for (const b of boxes.slice(i + 1)) {
          const a = boxes[i];
          assert(
            !(
              a.left < b.right &&
              a.right > b.left &&
              a.top < b.bottom &&
              a.bottom > b.top
            ),
            `Overlapping names: ${a.name} / ${b.name}`,
          );
        }
      }
    }
    const levels = [
      ["Valles Marineris", 10000, 1000, Infinity],
      ["Olympus Mons", 4500, 300, 1000],
      ["Gale", 2200, 100, 300],
      ["Jezero", 1100, 30, 100],
      ["Victoria", 500, 0, 30],
    ];
    for (const [level, [name, altitude, min, max]] of levels.entries()) {
      const result = await view(name, altitude, level);
      assert(result.names.length > 0, `Empty name layer ${level}`);
      assert(
        result.names.every((r) => r.diameter >= min),
        `Premature small names at level ${level}`,
      );
      assert(
        result.names.some((r) => r.diameter >= min && r.diameter < max),
        `Missing current size tier ${level}`,
      );
      await checkLayout();
      console.log(result.status, result.names.length, "visible names");
      if (level === 0 || level === 4)
        await page.screenshot({
          path: path.resolve(
            __dirname,
            `labels-${level === 0 ? "planet" : "local"}-preview.png`,
          ),
        });
    }
    // Names shrink back to the large-object layer when moving out again.
    const far = await view("Valles Marineris", 10000, 0);
    assert(far.names.every((r) => r.diameter >= 1000));
    await view("Valles Marineris", 6000, 1);
    await view("Valles Marineris", 6500, 1);
    await view("Valles Marineris", 7000, 0);
    await view("Valles Marineris", 6500, 0);
    // A deliberately selected tiny feature remains labeled at planet scale.
    await page.evaluate(() =>
      __globe.selectRegion(__globe.regions.find((r) => r.name === "Victoria")),
    );
    const selected = await view("Victoria", 10000, 0);
    assert(selected.names.some((r) => r.name === "Victoria"));
    assert(
      selected.names
        .filter((r) => r.name !== "Victoria")
        .every((r) => r.diameter >= 1000),
    );
    await page.click('#region-filters input[value="crater"]');
    await page.waitForFunction(
      () =>
        !__globe.selectedRegion &&
        __globe.placedLabels.every((b) => b.r.group !== "crater"),
    );
    await view("Victoria", 500, 4);
    assert(
      await page.evaluate(() =>
        __globe.placedLabels.every((b) => b.r.group !== "crater"),
      ),
    );
    await page.click('#region-filters input[value="crater"]');
    await page.setViewport({ width: 390, height: 844 });
    for (const [name, altitude, level] of [
      ["Valles Marineris", 10000, 0],
      ["Victoria", 500, 4],
    ]) {
      const result = await view(name, altitude, level);
      assert(result.names.length > 0 && result.names.length <= 22);
      await checkLayout();
    }
    await page.screenshot({
      path: path.resolve(__dirname, "labels-mobile-preview.png"),
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: five name levels, reverse zoom, hysteresis, selected-label exception, category filters, desktop/mobile collision checks, offline without browser errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
