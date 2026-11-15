const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  context = { window: {} };
for (const file of ["js/regions.js", "assets/wikipedia/catalogue.js"])
  vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), context);
const { MARS_REGIONS: regions, MARS_WIKIPEDIA: wiki } = context.window;
assert.equal(Object.keys(wiki.records).length, regions.length);
assert.equal(wiki.meta.total, 2054);
let texts = 0,
  images = 0;
for (const r of regions) {
  const w = wiki.records[r.id];
  assert(w, r.name);
  assert(["article", "not-found"].includes(w.status));
  if (w.status === "article") {
    texts++;
    assert(w.extract.length > 20, r.name);
    assert(w.url.startsWith("https://en.wikipedia.org/"));
    assert(w.revision > 0);
    assert(w.revisionUrl.includes(String(w.revision)));
    assert(w.match.method);
    assert.equal(w.textLicense, "CC BY-SA 4.0");
    assert(!/<script|<iframe|<img/i.test(w.extract));
  }
  if (w.image) {
    images++;
    const i = w.image;
    assert(i.author && i.license && i.page && i.source, r.name);
    assert(
      /^https:\/\/(commons\.wikimedia\.org|en\.wikipedia\.org)\//.test(i.page),
    );
    assert(i.local.startsWith("assets/wikipedia/"));
    const data = fs.readFileSync(path.join(root, i.local));
    assert(data.length > 100 && data.length <= 3_000_000);
    assert(
      data[0] === 0xff ||
        data.subarray(1, 4).toString() === "PNG" ||
        data.subarray(0, 4).toString() === "RIFF",
      r.name + " has invalid image bytes",
    );
  }
}
assert.equal(texts, wiki.meta.articles);
assert.equal(images, wiki.meta.images);
assert(texts > 1200);
assert(images > 400);
for (const name of ["Olympus Mons", "Valles Marineris", "Gale", "Jezero"]) {
  const r = regions.find((r) => r.name === name);
  assert(
    wiki.records[r.id].image,
    name + " needs its actual sourced illustration",
  );
}
const airy = regions.find((r) => r.name === "Airy");
assert.equal(wiki.records[airy.id].scope, "table-entry");
assert(wiki.records[airy.id].url.endsWith("#Airy"));
console.log(
  `PASS ${regions.length} Wikipedia records, ${texts} sourced references, ${images} local attributed images; missing entries explicit`,
);
