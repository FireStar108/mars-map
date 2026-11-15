/* Seeded exercise fields, NOT a survey of actual sand, rocks or rockfalls.
 * All scales, thresholds and response factors below are prototype assumptions.
 * Terrain only biases the generated pattern; it cannot identify soil or stability.
 */
(function (root) {
  "use strict";
  const keys = ["sand", "rocks", "rockfall", "cold"];
  const definitions = {
    sand: {
      name: "Loose sand / weak ground",
      color: [239, 190, 77],
      effect: "Traction loss and entrapment",
      source: "https://science.nasa.gov/mission/mer-spirit/",
    },
    rocks: {
      name: "Sharp rocks / boulders",
      color: [223, 126, 88],
      effect: "Wheel damage and obstructed access",
      source:
        "https://science.nasa.gov/mission/mars-2020-perseverance/rover-components/",
    },
    rockfall: {
      name: "Unstable slopes / rockfall",
      color: [224, 83, 121],
      effect: "Slope failure and falling material",
      source: "https://science.nasa.gov/photojournal/watch-for-falling-rocks/",
    },
    cold: {
      name: "Extreme cold",
      color: [109, 196, 245],
      effect: "Thermal operating limit and heating load",
      source: "https://science.nasa.gov/blog/its-cold-on-mars/",
    },
    solar: {
      name: "Solar particle event",
      color: [193, 137, 242],
      effect: "Shelter hold across the map",
      source:
        "https://www.nasa.gov/solar-system/planets/mars/nasa-watches-mars-light-up-during-epic-solar-storm/",
    },
  };
  const defaults = {
    enabled: true,
    seed: 20261115,
    sand: 0.4,
    rocks: 0.4,
    rockfall: 0.4,
    cold: 0.35,
    solar: 0,
    globalFocus: null,
    localFocus: null,
  };
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  function normalize(input = {}) {
    const c = { ...defaults, ...input };
    c.enabled = input.enabled !== false;
    c.seed = Number(c.seed) >>> 0;
    for (const k of [...keys, "solar"])
      c[k] = clamp(Number.isFinite(Number(c[k])) ? Number(c[k]) : defaults[k]);
    for (const scope of ["global", "local"]) {
      const f = c[scope + "Focus"];
      if (!f || !keys.includes(f.kind)) {
        c[scope + "Focus"] = null;
        continue;
      }
      const coords = scope === "global" ? ["lat", "lon"] : ["x", "y"];
      if (!coords.every((k) => Number.isFinite(Number(f[k])))) {
        c[scope + "Focus"] = null;
        continue;
      }
      c[scope + "Focus"] =
        scope === "global"
          ? {
              kind: f.kind,
              lat: clamp(Number(f.lat), -89, 89),
              lon: ((((Number(f.lon) + 180) % 360) + 360) % 360) - 180,
              radius: clamp(Number(f.radius) || 6, 2, 30),
              strength: clamp(Number(f.strength) || 1),
            }
          : {
              kind: f.kind,
              x: clamp(Number(f.x)),
              y: clamp(Number(f.y)),
              radius: clamp(Number(f.radius) || 0.1, 0.025, 0.4),
              strength: clamp(Number(f.strength) || 1),
            };
    }
    return c;
  }
  function rng(seed) {
    let n = seed >>> 0;
    return () => {
      n += 0x6d2b79f5;
      let t = n;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function generate(seed = Date.now() >>> 0) {
    const r = rng(seed);
    return normalize({
      seed,
      sand: 0.45 + r() * 0.55,
      rocks: 0.45 + r() * 0.55,
      rockfall: 0.45 + r() * 0.55,
      cold: 0.4 + r() * 0.6,
      solar: r() < 0.12 ? 0.8 : 0,
    });
  }
  function save(config) {
    const c = normalize(config);
    try {
      localStorage.setItem("mars-hazards-v1", JSON.stringify(c));
    } catch {}
    return c;
  }
  function load() {
    try {
      const u = new URL(location.href),
        q = u.searchParams.get("hazards");
      const c = normalize(
        JSON.parse(q || localStorage.getItem("mars-hazards-v1") || "{}"),
      );
      if (q) {
        save(c);
        u.searchParams.delete("hazards");
        try {
          history.replaceState(null, "", u.href);
        } catch {}
      }
      return c;
    } catch {
      return normalize();
    }
  }
  const caches = { global: null, local: null };
  function field(data, input, scope, width, height) {
    const config = normalize(input),
      signature = JSON.stringify(config),
      old = caches[scope];
    if (old?.data === data && old.signature === signature) return old.field;
    const count = width * height,
      channels = Object.fromEntries(
        keys.map((k) => [k, new Float32Array(count)]),
      );
    const result = {
      config,
      scope,
      width,
      height,
      channels,
      mask: new Uint8Array(count),
      factor: new Float32Array(count).fill(1),
      level: new Float32Array(count),
      drop: new Float32Array(count),
    };
    if (config.enabled) {
      const r = rng(config.seed + (scope === "global" ? 913 : 217));
      const blobs = keys.map(() =>
        Array.from({ length: scope === "global" ? 18 : 5 }, () => {
          if (scope === "local")
            return {
              x: 0.08 + 0.84 * r(),
              y: 0.08 + 0.84 * r(),
              rx: 0.055 + r() * 0.15,
              ry: 0.06 + r() * 0.16,
              phase: r() * Math.PI * 2,
            };
          const lat = Math.asin(r() * 2 - 1),
            lon = r() * Math.PI * 2,
            sigma = ((5 + r() * 16) * Math.PI) / 180;
          return {
            x: Math.cos(lat) * Math.cos(lon),
            y: Math.sin(lat),
            z: Math.cos(lat) * Math.sin(lon),
            sigma2: sigma * sigma,
            phase: r() * Math.PI * 2,
          };
        }),
      );
      const focus = config[scope + "Focus"];
      const fvec =
        focus && scope === "global"
          ? {
              x:
                Math.cos((focus.lat * Math.PI) / 180) *
                Math.cos((focus.lon * Math.PI) / 180),
              y: Math.sin((focus.lat * Math.PI) / 180),
              z:
                Math.cos((focus.lat * Math.PI) / 180) *
                Math.sin((focus.lon * Math.PI) / 180),
            }
          : null;
      const heights = scope === "global" ? data : data.heights;
      for (let i = 0; i < count; i++) {
        const x = i % width,
          y = Math.floor(i / width),
          u = (x + 0.5) / width,
          v = (y + 0.5) / height,
          z = heights[i];
        if (!Number.isFinite(z)) continue;
        const lat = (0.5 - v) * Math.PI,
          lon = (u * 2 - 1) * Math.PI;
        const vx = Math.cos(lat) * Math.cos(lon),
          vy = Math.sin(lat),
          vz = Math.cos(lat) * Math.sin(lon);
        let relief = 0;
        if (scope === "local") {
          // The nearby upslope height, not just the cell slope, keeps modeled
          // runout exposure on relatively flat ground below a scarp.
          const reach = Math.max(1, Math.round(70 / data.cellSize));
          for (const [dx, dy] of [
            [reach, 0],
            [-reach, 0],
            [0, reach],
            [0, -reach],
          ]) {
            const xx = x + dx,
              yy = y + dy;
            if (xx >= 0 && xx < width && yy >= 0 && yy < height) {
              const h = heights[yy * width + xx];
              if (Number.isFinite(h)) relief = Math.max(relief, (h - z) / 35);
            }
          }
          relief = clamp(Math.max(relief, (data.slopes[i] || 0) / 35));
        } else {
          for (const j of [
            y * width + ((x + 1) % width),
            y * width + ((x + width - 1) % width),
            Math.max(0, y - 1) * width + x,
            Math.min(height - 1, y + 1) * width + x,
          ])
            if (Number.isFinite(heights[j]))
              relief = Math.max(relief, Math.abs(heights[j] - z) / 1600);
          relief = clamp(relief);
        }
        for (let k = 0; k < keys.length; k++) {
          let value = 0;
          for (const b of blobs[k]) {
            const q =
              scope === "local"
                ? ((u - b.x) / b.rx) ** 2 + ((v - b.y) / b.ry) ** 2
                : (2 * Math.max(0, 1 - (vx * b.x + vy * b.y + vz * b.z))) /
                  b.sigma2;
            if (q > 14) continue;
            const ripple =
              0.88 +
              0.12 *
                Math.sin(
                  (scope === "local"
                    ? u * 31 + v * 23
                    : vx * 17 + vy * 13 + vz * 11) + b.phase,
                );
            value = Math.max(value, Math.exp(-0.5 * q) * ripple);
          }
          const kind = keys[k];
          let bias =
            kind === "sand"
              ? 1 - 0.22 * relief
              : kind === "rocks"
                ? 0.65 + 0.35 * relief
                : kind === "rockfall"
                  ? 0.22 + 0.78 * relief
                  : scope === "global"
                    ? 0.55 + 0.45 * Math.abs(vy)
                    : 1;
          value = clamp(value * config[kind] * bias);
          if (focus?.kind === kind) {
            const q =
              scope === "local"
                ? ((u - focus.x) / focus.radius) ** 2 +
                  ((v - focus.y) / focus.radius) ** 2
                : (2 *
                    Math.max(
                      0,
                      1 - (vx * fvec.x + vy * fvec.y + vz * fvec.z),
                    )) /
                  ((focus.radius * Math.PI) / 180) ** 2;
            value = Math.max(value, focus.strength * Math.exp(-0.5 * q));
          }
          channels[kind][i] = value;
        }
        const sand = channels.sand[i],
          rocks = channels.rocks[i],
          fall = channels.rockfall[i],
          cold = channels.cold[i];
        result.factor[i] =
          1 + 2.2 * sand * sand + 1.3 * rocks * rocks + 1.5 * fall * fall;
        result.level[i] = Math.max(sand, rocks, fall, cold, config.solar);
        result.drop[i] = 75 * cold;
        result.mask[i] =
          (sand >= 0.8 ? 1 : 0) |
          (rocks >= 0.8 ? 2 : 0) |
          (fall >= 0.8 ? 4 : 0) |
          (config.solar >= 0.7 ? 16 : 0);
      }
    }
    caches[scope] = { data, signature, field: result };
    return result;
  }
  function globalField(heights, config, width = 360, height = 180) {
    return field(heights, config, "global", width, height);
  }
  function localField(data, config) {
    return field(data, config, "local", data.width, data.height);
  }
  function apply(weather, field, index) {
    if (!field.config.enabled)
      return { ...weather, hazardMask: 0, hazardLevel: 0 };
    const temperature = weather.temperature - field.drop[index];
    const extraCold =
      0.007 *
      (Math.max(0, -40 - temperature) - Math.max(0, -40 - weather.temperature));
    return {
      ...weather,
      temperature,
      penalty: (weather.penalty + extraCold) * field.factor[index],
      hazardMask:
        field.mask[index] |
        (field.drop[index] > 0 && temperature < -100 ? 8 : 0),
      hazardLevel: field.level[index],
    };
  }
  function values(field, index) {
    const v = Object.fromEntries(
      keys.map((k) => [k, field.channels[k][index]]),
    );
    v.solar = field.config.enabled ? field.config.solar : 0;
    return v;
  }
  function reasons(mask) {
    return [
      [1, "Loose sand / weak ground exceeds the scenario limit."],
      [2, "Sharp rocks / boulders exceed the scenario limit."],
      [4, "Unstable slope / rockfall zone exceeds the scenario limit."],
      [8, "Generated cold zone exceeds the thermal operating limit."],
      [
        16,
        "Solar particle alert: shelter and wait; a geographic detour cannot clear this hold.",
      ],
    ]
      .filter(([b]) => mask & b)
      .map(([, s]) => s);
  }
  function description(field, index, cell) {
    const v = values(field, index),
      worst = Object.keys(v).sort((a, b) => v[b] - v[a])[0];
    return `${definitions[worst].name} ${Math.round(v[worst] * 100)}/100 · ${cell.hazardMask ? "BLOCKED" : "scenario exposure"}${cell.hazardMask ? " · " + reasons(cell.hazardMask).join(" ") : ""}`;
  }
  function rgba(field, index, cell, layer = "hazards") {
    const v = values(field, index),
      kind =
        keys.includes(layer) || layer === "solar"
          ? layer
          : Object.keys(v).sort((a, b) => v[b] - v[a])[0],
      level = v[kind];
    const relevant =
      layer === "hazards"
        ? cell.hazardMask
        : cell.hazardMask &
          { sand: 1, rocks: 2, rockfall: 4, cold: 8, solar: 16 }[kind];
    if (!field.config.enabled || level < 0.035) return [0, 0, 0, 0];
    const color = definitions[kind].color;
    // High-contrast hatching identifies a hard closure; color alone is not the key.
    if (
      relevant &&
      ((index % field.width) + Math.floor(index / field.width)) % 6 < 2
    )
      return [255, 245, 232, 235];
    return [...color, Math.round(30 + level * 185 + (relevant ? 30 : 0))];
  }
  function evidenceHtml() {
    return `<h3>Generated hazards · evidence and assumptions</h3><p>These layers are reproducible scenario fields, not remotely detected hazards or probabilities. Sand, rock abundance and slope instability cannot be inferred reliably from the global MOLA grid. Terrain only biases the generated fields; the local layer uses nearby relief as a rough exposure cue, not a rockfall simulation. Global and local patterns are generated at different scales.</p>${Object.entries(
      definitions,
    )
      .map(
        ([k, d]) =>
          `<p><strong>${d.name}:</strong> ${d.effect}. <a href="${d.source}" target="_blank" rel="noopener">NASA/JPL evidence ↗</a></p>`,
      )
      .join(
        "",
      )}<p>Scenario indices at or above 80/100 close sand, boulder and unstable-slope cells. Generated cold subtracts up to75 °C from the weather scenario and uses the existing −100 °C operating hold. Solar intensity at or above70/100 requires shelter across the entire map. These numbers are design assumptions, not validated astronaut or vehicle limits. Lower indices increase modeled travel time and exposure cost. No dose or accident probability is calculated.</p>`;
  }
  function legendHtml(layer) {
    const names = {
      sand: "Sand",
      rocks: "Boulders",
      rockfall: "Rockfall",
      cold: "Cold",
      solar: "Solar",
    };
    const list = definitions[layer] ? [layer] : Object.keys(names);
    return `<span class="hazard-key-row">${list.map((k) => `<span class="hazard-key"><i style="background:rgb(${definitions[k].color})"></i>${names[k]}</span>`).join("")}</span>`;
  }
  root.MarsHazards = {
    keys,
    definitions,
    defaults,
    normalize,
    generate,
    save,
    load,
    globalField,
    localField,
    apply,
    values,
    reasons,
    description,
    rgba,
    evidenceHtml,
    legendHtml,
  };
})(typeof window === "undefined" ? globalThis : window);
