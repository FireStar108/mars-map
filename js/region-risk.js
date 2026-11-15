/* Area screening uses exactly the planner's cached weather/hazard cells.
 * Source terrain and generated conditions are deliberately described separately.
 */
(function (root) {
  "use strict";
  const $ = (id) => document.getElementById(id),
    DEG = Math.PI / 180;
  const membership = new Map();
  let current = null,
    lastReport = null;
  const clamp = (n) => Math.max(0, Math.min(1, n));
  function direction(from, to) {
    const a = from.lat * DEG,
      b = to.lat * DEG,
      dl = (to.lon - from.lon) * DEG;
    const h =
      Math.sin((b - a) / 2) ** 2 +
      Math.cos(a) * Math.cos(b) * Math.sin(dl / 2) ** 2;
    const distance = 2 * 3396.19 * Math.asin(Math.sqrt(clamp(h)));
    const bearing =
      (Math.atan2(
        Math.sin(dl) * Math.cos(b),
        Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(dl),
      ) /
        DEG +
        360) %
      360;
    return {
      distance,
      bearing,
      compass: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
        Math.round(bearing / 45) % 8
      ],
    };
  }
  function point(index) {
    return { lat: 89.5 - Math.floor(index / 360), lon: (index % 360) - 179.5 };
  }
  function indexAt(r) {
    return (
      Math.min(179, Math.max(0, Math.floor(90 - r.lat))) * 360 +
      Math.min(359, Math.max(0, Math.floor((r.lon + 540) % 360)))
    );
  }
  function cellsFor(region) {
    if (membership.has(region.id)) return membership.get(region.id);
    const globe = root.__globe,
      cells = [],
      n = new THREE.Vector3();
    if (region.area.polygons.length) {
      const cap = Math.sqrt(Math.max(0, 1 - 2 * region.area.s ** 2));
      for (let row = 0; row < 180; row++) {
        const la = (89.5 - row) * DEG,
          c = Math.cos(la),
          s = Math.sin(la);
        for (let col = 0; col < 360; col++) {
          const lo = (col - 179.5) * DEG;
          n.set(c * Math.cos(lo), s, -c * Math.sin(lo));
          if (n.dot(region._normal) >= cap && globe.regionContains(region, n))
            cells.push(row * 360 + col);
        }
      }
    }
    const result = {
      cells: cells.length ? cells : [indexAt(region)],
      pointOnly: !cells.length,
    };
    membership.set(region.id, result);
    if (membership.size > 12) membership.delete(membership.keys().next().value);
    return result;
  }
  function assess(region) {
    const planner = root.__globalPlanner,
      engine = root.__globe.engine;
    const scenario = engine.getScenario(planner.options()),
      area = cellsFor(region);
    const peaks = Object.fromEntries(
      ["dust", ...MarsHazards.keys, "solar"].map((k) => [
        k,
        { value: 0, index: area.cells[0] },
      ]),
    );
    let closed = 0,
      wind = 0,
      visibility = Infinity,
      temperature = Infinity,
      score = 0;
    let minZ = Infinity,
      maxZ = -Infinity,
      maxSlope = 0,
      steepSum = 0,
      terrainWeight = 0,
      terrainPeak = area.cells[0];
    const terrain = root.MARS_HRSC_SUMMARY;
    const closureReasons = new Set();
    for (const index of area.cells) {
      const w = scenario.cells[index],
        h = MarsHazards.values(scenario.hazardField, index);
      const values = {
        ...h,
        dust: w.dust,
        cold: Math.max(h.cold, clamp((-w.temperature - 60) / 40)),
      };
      for (const k of Object.keys(peaks))
        if (values[k] > peaks[k].value) peaks[k] = { value: values[k], index };
      const hold =
        !!w.hazardMask ||
        w.wind >= 50 ||
        w.visibility < 100 ||
        w.temperature < -100;
      if (hold) closed++;
      if (w.wind >= 50) closureReasons.add("wind ≥50 m/s");
      if (w.visibility < 100) closureReasons.add("visibility <100 m");
      if (w.temperature < -100) closureReasons.add("temperature <−100 °C");
      for (const reason of MarsHazards.reasons(w.hazardMask || 0))
        closureReasons.add(reason);
      wind = Math.max(wind, w.wind);
      visibility = Math.min(visibility, w.visibility);
      temperature = Math.min(temperature, w.temperature);
      score = Math.max(
        score,
        w.hazardLevel || 0,
        w.dust,
        0.85 * clamp(w.wind / 50),
        clamp((600 - w.visibility) / 500),
        clamp((-w.temperature - 60) / 40),
      );
      if (terrain?.valid[index]) {
        minZ = Math.min(minZ, terrain.minimum[index]);
        maxZ = Math.max(maxZ, terrain.maximum[index]);
        if (terrain.peakSlope[index] > maxSlope) {
          maxSlope = terrain.peakSlope[index];
          terrainPeak = index;
        }
        const weight = Math.cos(point(index).lat * DEG);
        steepSum += terrain.steepPercent[index] * weight;
        terrainWeight += weight;
      }
    }
    const steepPercent = terrainWeight ? steepSum / terrainWeight : null;
    if (steepPercent !== null)
      score = Math.max(
        score,
        Math.min(0.9, (steepPercent / 100) * 3 + maxSlope / 180),
      );
    if (closed) score = 1;
    const centre = scenario.cells[indexAt(region)],
      solar = peaks.solar.value >= 0.7;
    return {
      regionId: region.id,
      sampleCount: area.cells.length,
      pointOnly: area.pointOnly,
      peaks,
      closed,
      solar,
      score: Math.round(score * 100),
      level: closed
        ? "hold"
        : score >= 0.7
          ? "high"
          : score >= 0.35
            ? "moderate"
            : "low",
      wind,
      visibility,
      temperature,
      centre,
      closureReasons: [...closureReasons],
      terrain: terrainWeight
        ? { minZ, maxZ, maxSlope, steepPercent, peak: terrainPeak }
        : null,
      weatherSeed: scenario.weather.seed,
      hazardSeed: scenario.hazardField.config.seed,
    };
  }
  function node(tag, text, cls) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }
  function chooseTab(tab, focus = false) {
    for (const name of ["risk", "wiki"]) {
      const active = name === tab,
        button = $("region-tab-" + name);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      $("region-panel-" + name).hidden = !active;
      if (active && focus) button.focus();
    }
    root.__globe?.markDirty();
  }
  for (const tab of ["risk", "wiki"]) {
    $("region-tab-" + tab).onclick = () => chooseTab(tab);
    $("region-tab-" + tab).onkeydown = (e) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        chooseTab(
          e.key === "Home"
            ? "risk"
            : e.key === "End"
              ? "wiki"
              : tab === "risk"
                ? "wiki"
                : "risk",
          true,
        );
      }
    };
  }
  function locationText(region, index, pointOnly) {
    if (pointOnly) return "Centre cell only · direction unresolved at 1° scale";
    const d = direction(region, point(index));
    return d.distance < 35
      ? "Near the centre · within one 1° cell"
      : `${d.compass} · ≈${Math.round(d.distance)} km from centre`;
  }
  function update() {
    if (!current || !root.__globalPlanner) return;
    const { region } = current,
      report = assess(region);
    lastReport = report;
    const host = $("region-risk");
    host.replaceChildren();
    host.dataset.level = report.level;
    const box = node("div", undefined, "risk-summary"),
      heading = node("div", undefined, "risk-heading");
    box.dataset.level = report.level;
    heading.append(
      node(
        "strong",
        report.solar
          ? "SHELTER / WAIT"
          : report.closed
            ? "CLOSED ZONES"
            : report.level.toUpperCase() + " RISK",
      ),
      node("span", `${report.score} / 100`),
    );
    box.append(
      heading,
      node(
        "p",
        report.solar
          ? "Solar particle event affects the whole map. A detour does not remove this hold."
          : report.closed
            ? `${report.closed} of ${report.sampleCount} sampled cells exceed travel limits. Check a detour or change the scenario.`
            : "No sampled cell exceeds the current scenario limits. Detailed route checks are still required.",
      ),
    );
    host.append(
      box,
      node(
        "p",
        `SCENARIO · weather ${report.weatherSeed} / hazards ${report.hazardSeed} · screening index, not accident probability`,
        "risk-caption",
      ),
    );
    const weather = node("div", undefined, "risk-weather");
    for (const [label, value] of [
      ["Peak wind", `${report.wind.toFixed(1)} m/s`],
      ["Min visibility", `${Math.round(report.visibility)} m`],
      ["Lowest temp.", `${Math.round(report.temperature)} °C`],
    ]) {
      const cell = node("div", label);
      cell.prepend(node("strong", value));
      weather.append(cell);
    }
    host.append(weather);
    const list = node("ul", undefined, "risk-hazards");
    for (const key of ["dust", "sand", "rocks", "rockfall", "cold", "solar"]) {
      const p = report.peaks[key],
        row = node("li"),
        header = node("header"),
        intensity = Math.round(p.value * 100);
      const active = p.value >= 0.1,
        blocked =
          key === "solar"
            ? p.value >= 0.7
            : ["sand", "rocks", "rockfall"].includes(key) && p.value >= 0.8;
      row.dataset.hazard = key;
      row.dataset.closed = String(blocked);
      header.append(
        node(
          "span",
          key === "dust"
            ? "Dust storm / low visibility"
            : MarsHazards.definitions[key].name,
        ),
        node("b", `${intensity} / 100`),
      );
      const bar = node("div", undefined, "risk-bar"),
        fill = node("i");
      fill.style.width = intensity + "%";
      bar.append(fill);
      const description =
        key === "solar"
          ? active
            ? "Whole area · no local compass direction"
            : "No solar event in this scenario"
          : active
            ? "Strongest sampled zone: " +
              locationText(region, p.index, report.pointOnly)
            : "Below 10/100 in sampled cells · no strong zone identified";
      row.append(header, bar, node("p", description));
      if (blocked)
        row.append(
          node(
            "p",
            key === "solar"
              ? "Shelter required by the scenario rules."
              : "Peak exceeds the scenario traversal limit.",
          ),
        );
      list.append(row);
    }
    host.append(list);
    if (report.terrain) {
      const t = report.terrain;
      host.append(
        node(
          "p",
          `HRSC/MOLA terrain: ${t.minZ.toLocaleString("en")}…${t.maxZ.toLocaleString("en")} m. ${t.steepPercent.toFixed(1)}% of regional samples have slope ≥15°; peak ${t.maxSlope.toFixed(1)}° (${locationText(region, t.peak, report.pointOnly)}).`,
          "risk-evidence",
        ),
      );
    }
    if (report.closureReasons.length)
      host.append(
        node(
          "p",
          "Travel limits: " + report.closureReasons.join(" · "),
          "risk-evidence",
        ),
      );
    host.append(
      node(
        "p",
        report.pointOnly
          ? "Area too small or boundary unresolved: centre-cell screening only. No area-wide safety conclusion."
          : `${report.sampleCount} grid centres inside the approximate contour. Strongest sampled zones are reported, not verified disaster epicentres.`,
        "risk-evidence",
      ),
    );
    host.append(
      node(
        "p",
        "Weather/hazards: generated 1° fields shared with routing. Terrain: 1° summaries derived from the 200 m DEM; edge cells include nearby terrain. These data cannot resolve individual cliffs or establish safe passage.",
        "risk-evidence",
      ),
    );
    const historical = root.__globe.engine.sample(
      region.lat,
      region.lon,
      Number($("planet-season").value),
    );
    $("region-environment").textContent =
      `Historical dust: ${historical.dustCount ?? "unknown"} detections near the centre in the selected season. Relative radiation/shielding proxy ${historical.radiationRelative?.toFixed(2) ?? "unknown"}×; not a dose measurement or live event.`;
  }
  root.addEventListener("mars-conditions-change", update);
  root.MarsRegionRisk = {
    render(region, description) {
      current = { region, description };
      $("region-contents").textContent = description;
      chooseTab("risk");
      update();
    },
    clear() {
      current = null;
      lastReport = null;
    },
    assess,
    direction,
    chooseTab,
    get report() {
      return lastReport;
    },
  };
})(window);
