const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const ctx = { window: {}, console };
vm.createContext(ctx);
for (const name of ["weather", "global-model", "valles-model"])
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/" + name + ".js"), "utf8"),
    ctx,
  );
const { MarsWeather: W, VallesModel: M, GlobalModel: G } = ctx.window;
const data = {
  width: 80,
  height: 60,
  cellSize: 10,
  extent: 800,
  base: { x: 55, y: 305 },
  heights: Array(4800).fill(0),
  slopes: Array(4800).fill(0),
};
const target = { x: 745, y: 305 },
  settings = { limit: 240, reserve: 20, science: 20 };
const clear = W.normalize({
  temperature: -35,
  wind: 4,
  visibility: 3000,
  severity: 0,
});
const storm = W.normalize({
  ...clear,
  severity: 1,
  stormX: 0.5,
  stormY: 0.5,
  stormRadius: 0.18,
});
const pathKey = (r) => r.points.map((p) => p.index).join(",");
const a = M.plan(data, target, clear),
  b = M.plan(data, target, storm);
assert.notEqual(
  pathKey(a[1]),
  pathKey(b[1]),
  "Spatial weather must change adaptive geometry in a plume-crossing case",
);
assert.equal(
  pathKey(b[1]),
  pathKey(M.plan(data, target, storm)[1]),
  "Same scenario must repeat",
);
const af = W.localField(data, clear),
  bf = W.localField(data, storm);
const before = M.evaluate(a[0], clear, settings, af),
  after = M.evaluate(a[0], storm, settings, bf);
assert(after.total > before.total, "Storm must slow the same route");
const bs = b.map((r) => M.evaluate(r, storm, settings, bf));
assert(
  bs[1].score < bs[0].score,
  "Adaptive route must improve actual assessed objective",
);
const held = W.normalize({ ...clear, wind: 40, severity: 0 }),
  h = M.plan(data, target, held);
assert.equal(h.length, 1);
assert.equal(
  M.recommend(h.map((r) => M.evaluate(r, held, settings))),
  null,
  "No false recommendation under blanket hold",
);
const seeded = W.generate(123456);
assert.equal(JSON.stringify(seeded), JSON.stringify(W.generate(123456)));
const ramp = {
  ...data,
  heights: data.heights.map((_, i) => (i % 80) * 2),
  slopes: Array(4800).fill(12),
};
const east = W.localField(ramp, { ...clear, direction: 90 }),
  west = W.localField(ramp, { ...clear, direction: 270 });
assert(
  east.cells[2440].wind < west.cells[2440].wind,
  "Upwind terrain must affect exposure",
);
const global = G.create(
  { width: 72, height: 36, heights: Array(2592).fill(0) },
  [],
);
const opts = {
  ls: 90,
  dustWeight: 0,
  radiationWeight: 0,
  speed: 20,
  hoursPerSol: 8,
};
const start = { lat: 0, lon: -45 },
  end = { lat: 0, lon: 45 };
const ga = global.plan(start, end, { ...opts, weather: clear });
const gb = global.plan(start, end, {
  ...opts,
  weather: { ...clear, lat: 0, lon: 0, radius: 10, severity: 1 },
});
assert.notEqual(
  JSON.stringify(ga.routes[1].points),
  JSON.stringify(gb.routes[1].points),
);
assert(gb.routes[0].sols > ga.routes[0].sols);
assert(gb.routes[1].score < gb.routes[0].score);
assert.equal(
  global.plan(start, end, { ...opts, weather: { ...clear, visibility: 50 } })
    .recommendedId,
  null,
);
console.log(
  "PASS spatial replanning, deterministic scenarios, same-edge costs, exposure, time and blanket holds on both maps",
);
