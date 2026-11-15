// Offline regression guard for broken stylesheet assets and incomplete catalogue bundles.
// Run: node tests/check-assets.cjs
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
for (const file of ["index.html", "valles.html", "jezero.html"]) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  for (const m of html.matchAll(
    /(?:src|href)="([^"#]+\.(?:css|js)(?:\?[^"#]*)?)"/g,
  )) {
    if (/^https?:/.test(m[1])) continue;
    const assetPath = m[1].split("?")[0];
    const asset = fs.readFileSync(path.join(root, assetPath), "utf8");
    assert(
      !/^\s*<!doctype|^\s*<html/i.test(asset),
      `${m[1]} contains HTML instead of its declared asset type`,
    );
    if (assetPath.endsWith(".js")) new vm.Script(asset, { filename: m[1] });
    else
      assert(
        asset.includes("{") && asset.includes("}"),
        `No stylesheet rules in ${m[1]}`,
      );
  }
}
const context = { window: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(root, "js/regions.js"), "utf8"),
  context,
);
const regions = context.window.MARS_REGIONS;
assert(regions.length >= 2054, "Lost known IAU catalogue records");
assert.equal(
  new Set(regions.map((r) => r.id)).size,
  regions.length,
  "Duplicate IAU IDs",
);
assert.equal(new Set(regions.map((r) => r.group)).size, 7);
for (const r of regions) {
  assert(
    r.source.startsWith("https://planetarynames.wr.usgs.gov/Feature/"),
    r.name,
  );
  assert(r.area.s > 0 && r.area.s < 1, `Missing area for ${r.name}`);
  assert.notEqual(
    r.area.method,
    "nominal",
    `Invented nominal boundary: ${r.name}`,
  );
  if (r.area.method === "unresolved") {
    assert.equal(r.area.polygons.length, 0);
    assert.equal(r.area.km2, null);
    continue;
  }
  assert(r.area.polygons.length > 0, r.name);
  assert(Number.isFinite(r.area.km2) && r.area.km2 > 0, r.name);
  for (const polygon of r.area.polygons)
    for (const ring of polygon) {
      assert(ring.length >= 4, `Invalid polygon ${r.name}`);
      assert.deepEqual(ring[0], ring.at(-1), `Open polygon ${r.name}`);
      assert(
        ring.every((p) => p.length === 2 && p.every(Number.isFinite)),
        r.name,
      );
    }
}
assert.equal(
  regions.find((r) => r.name === "Valles Marineris").area.method,
  "terrain",
);
assert.equal(
  regions.find((r) => r.name === "Nili Fossae").area.method,
  "linear",
);
const audit = JSON.parse(
  fs.readFileSync(path.join(root, "data/boundary-audit.json"), "utf8"),
);
assert.equal(audit.summary.total, regions.length);
assert.equal(
  audit.summary.statuses["geometry-checked"],
  regions.filter((r) => r.area.polygons.length).length,
);
assert(audit.records.every((r) => r.status !== "failed"));
assert(
  regions.every(
    (r) => r.area.audit && r.area.audit.physicalBoundaryVerified === false,
  ),
);
console.log(
  `PASS: stylesheet/script references, ${regions.length} unique names, 7 groups, valid area geometry`,
);
