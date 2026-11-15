const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const ctx = { window: {}, console };
vm.createContext(ctx);
for (const name of ["hazards", "weather", "global-model", "valles-model"])
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/" + name + ".js"), "utf8"),
    ctx,
  );
const {
  MarsHazards: H,
  MarsWeather: W,
  GlobalModel: G,
  VallesModel: M,
} = ctx.window;
const clear = W.normalize({
  temperature: -45,
  wind: 4,
  visibility: 3000,
  severity: 0,
});
const off = H.normalize({ enabled: false });
const empty = {
  enabled: true,
  seed: 12,
  sand: 0,
  rocks: 0,
  rockfall: 0,
  cold: 0,
  solar: 0,
};
assert.equal(JSON.stringify(H.generate(99)), JSON.stringify(H.generate(99)));
const heights = Array(360 * 180).fill(0),
  g = G.create({ width: 360, height: 180, heights }, []),
  opts = {
    weather: clear,
    dustWeight: 0,
    radiationWeight: 0,
    speed: 20,
    hoursPerSol: 8,
  };
const start = { lat: 0, lon: -30 },
  end = { lat: 0, lon: 30 };
for (const kind of H.keys) {
  const config = {
    ...empty,
    globalFocus: { kind, lat: 0, lon: 0, radius: 6, strength: 1 },
  };
  const result = g.plan(start, end, { ...opts, hazards: config });
  assert.equal(
    result.routes[0].feasible,
    false,
    kind + " baseline must cross a closure",
  );
  const safe = result.routes.find((r) => r.id === result.recommendedId);
  assert(safe?.feasible, kind + " needs a detour");
  assert(safe.distanceKm > result.routes[0].distanceKm);
  assert(
    safe.points.every(
      (p) =>
        !g.scenarioSample(p.lat, p.lon, { ...opts, hazards: config })
          .hazardMask,
    ),
    kind + " route must not touch blocked cells",
  );
  assert(
    result.routes[0].blockers.some((s) =>
      s
        .toLowerCase()
        .includes(
          { sand: "sand", rocks: "rocks", rockfall: "slope", cold: "cold" }[
            kind
          ],
        ),
    ),
  );
  const restored = g.plan(start, end, { ...opts, hazards: config });
  assert.equal(JSON.stringify(restored.routes), JSON.stringify(result.routes));
}
const allHold = g.plan(start, end, {
  ...opts,
  hazards: { ...empty, solar: 0.9 },
});
assert.equal(allHold.recommendedId, null);
assert.equal(allHold.routes.length, 1);
assert(allHold.routes[0].blockers.some((s) => s.includes("shelter")));
assert(
  g.plan(start, end, {
    ...opts,
    hazards: { ...empty, solar: 0.9, enabled: false },
  }).recommendedId,
);
const data = {
    width: 80,
    height: 60,
    cellSize: 10,
    extent: 800,
    base: { x: 55, y: 305 },
    heights: Array(4800).fill(0),
    slopes: Array(4800).fill(0),
  },
  target = { x: 745, y: 305 },
  settings = { limit: 300, reserve: 20, science: 20 };
for (const kind of H.keys) {
  const config = {
      ...empty,
      localFocus: { kind, x: 0.5, y: 0.5, radius: 0.12, strength: 1 },
    },
    field = W.localField(data, clear, config),
    routes = M.plan(data, target, clear, field).map((r) =>
      M.evaluate(r, clear, settings, field),
    );
  assert(!routes[0].feasible, kind + " local baseline");
  const best = M.recommend(routes);
  assert(best?.feasible, kind + " local detour");
  assert(best.points.every((p) => !field.cells[p.index].hazardMask));
}
const localHold = W.localField(data, clear, { ...empty, solar: 0.9 });
assert.equal(
  M.recommend(
    M.plan(data, target, clear, localHold).map((r) =>
      M.evaluate(r, clear, settings, localHold),
    ),
  ),
  null,
);
const a = H.globalField(heights, H.generate(42)),
  b = H.globalField(heights, H.generate(43));
assert.notEqual(
  Buffer.from(a.channels.sand.buffer).toString("base64"),
  Buffer.from(b.channels.sand.buffer).toString("base64"),
);
for (const k of H.keys)
  assert(a.channels[k].every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
console.log(
  "PASS all four generated closures cause detours on both scales; deterministic fields; same-field probes; solar shelter hold; disabled scenarios restore access",
);
