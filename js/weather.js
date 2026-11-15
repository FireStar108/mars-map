/* Reproducible, user-defined scenarios. These are not weather observations or forecasts. */
(function (root) {
  "use strict";
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const defaults = {
    temperature: -45,
    wind: 8,
    direction: 90,
    visibility: 2400,
    severity: 0.65,
    stormX: 0.5,
    stormY: 0.5,
    stormRadius: 0.22,
    lat: -8,
    lon: -70,
    radius: 12,
    seed: 42,
  };
  function normalize(input = {}) {
    const w = { ...defaults };
    for (const key of Object.keys(w))
      if (Number.isFinite(Number(input[key]))) w[key] = Number(input[key]);
    w.temperature = clamp(w.temperature, -120, 10);
    w.wind = clamp(w.wind, 0, 40);
    w.direction = ((w.direction % 360) + 360) % 360;
    w.visibility = clamp(w.visibility, 50, 10000);
    w.severity = clamp(w.severity, 0, 1);
    w.stormX = clamp(w.stormX, 0, 1);
    w.stormY = clamp(w.stormY, 0, 1);
    w.stormRadius = clamp(w.stormRadius, 0.06, 0.8);
    w.lat = clamp(w.lat, -90, 90);
    w.lon = ((((w.lon + 180) % 360) + 360) % 360) - 180;
    w.radius = clamp(w.radius, 2, 60);
    w.seed = w.seed >>> 0;
    return w;
  }
  function generate(seed = Date.now() >>> 0) {
    let n = seed >>> 0;
    const random = () => {
      n += 0x6d2b79f5;
      let t = n;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return normalize({
      seed,
      temperature: Math.round(-80 + random() * 60),
      wind: Math.round(3 + random() * 25),
      direction: Math.round(random() * 360),
      visibility: Math.round((300 + random() * 2700) / 50) * 50,
      severity: 0.2 + random() * 0.8,
      stormX: 0.2 + random() * 0.6,
      stormY: 0.2 + random() * 0.6,
      stormRadius: 0.12 + random() * 0.22,
      lat: -45 + random() * 90,
      lon: -180 + random() * 360,
      radius: 8 + random() * 24,
    });
  }
  function save(w) {
    try {
      localStorage.setItem("mars-map-weather-v1", JSON.stringify(normalize(w)));
    } catch {}
    return normalize(w);
  }
  function load() {
    try {
      const url = new URL(location.href),
        q = url.searchParams.get("weather");
      const value = normalize(
        JSON.parse(q || localStorage.getItem("mars-map-weather-v1") || "{}"),
      );
      if (q) {
        save(value);
        url.searchParams.delete("weather");
        try {
          history.replaceState(null, "", url.href);
        } catch {}
      }
      return value;
    } catch {
      return normalize();
    }
  }
  function globalAt(w, lat, lon) {
    const rad = Math.PI / 180,
      dl = (lon - w.lon) * rad;
    const h =
      Math.sin(((lat - w.lat) * rad) / 2) ** 2 +
      Math.cos(lat * rad) * Math.cos(w.lat * rad) * Math.sin(dl / 2) ** 2;
    const angle = (2 * Math.asin(Math.sqrt(clamp(h, 0, 1)))) / rad;
    const dust = w.severity * Math.exp(-0.5 * (angle / w.radius) ** 2);
    return conditions(w, dust, w.wind * (1 + 0.9 * dust), w.temperature);
  }
  function conditions(w, dust, wind, temperature) {
    const visibility = w.visibility / (1 + 6 * dust);
    const penalty =
      1 +
      0.025 * wind +
      0.007 * Math.max(0, -40 - temperature) +
      1.8 * dust +
      Math.max(0, 600 - visibility) / 600;
    return { wind, temperature, visibility, dust, penalty };
  }
  function localField(data, weather, hazardConfig = { enabled: false }) {
    const w = normalize(weather),
      n = data.width * data.height;
    const hazardField = root.MarsHazards?.localField(data, hazardConfig);
    const field = { weather: w, cells: new Array(n), hazards: hazardField };
    const angle = (w.direction * Math.PI) / 180;
    const bx = Math.floor(data.base.x / data.cellSize),
      by = Math.floor(data.base.y / data.cellSize);
    const reference = data.heights[by * data.width + bx] || 0;
    for (let i = 0; i < n; i++) {
      const x = i % data.width,
        y = Math.floor(i / data.width),
        z = data.heights[i];
      if (!Number.isFinite(z)) {
        field.cells[i] = null;
        continue;
      }
      let obstruction = 0,
        samples = 0;
      for (const metres of [30, 60, 120, 200]) {
        const xx = Math.round(x + (Math.sin(angle) * metres) / data.cellSize),
          yy = Math.round(y - (Math.cos(angle) * metres) / data.cellSize);
        if (xx < 0 || xx >= data.width || yy < 0 || yy >= data.height) continue;
        const up = data.heights[yy * data.width + xx];
        if (!Number.isFinite(up)) continue;
        obstruction += clamp((up - z) / metres, -0.4, 0.6);
        samples++;
      }
      const exposure = clamp(
        1 - (samples ? obstruction / samples : 0) * 2,
        0.25,
        1.6,
      );
      const d = Math.hypot(
        (x + 0.5) / data.width - w.stormX,
        (y + 0.5) / data.height - w.stormY,
      );
      const dust = w.severity * Math.exp(-0.5 * (d / w.stormRadius) ** 2);
      field.cells[i] = {
        ...conditions(
          w,
          dust,
          w.wind * exposure * (1 + 0.6 * dust),
          w.temperature - 0.004 * (z - reference),
        ),
        exposure,
      };
      if (hazardField)
        field.cells[i] = root.MarsHazards.apply(field.cells[i], hazardField, i);
    }
    return field;
  }
  root.MarsWeather = {
    defaults,
    normalize,
    generate,
    save,
    load,
    globalAt,
    localField,
  };
})(typeof window === "undefined" ? globalThis : window);
