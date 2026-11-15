"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const data = window.JEZERO;
  const reference = window.JEZERO_REFERENCE;
  const model = window.JezeroModel;
  if (!data || !model) {
    $("data-status").textContent = "Terrain failed to load";
    $("recommendation").textContent =
      "Keep this HTML file with its assets and js folders, then reload.";
    $("start-demo").disabled = true;
    return;
  }
  const colors = { direct: "#ffb777", gentle: "#b2e4c1" };
  const state = {
    target: data.targets[0],
    routes: [],
    evaluations: [],
    selected: "gentle",
    recommended: null,
    layer: "surface",
    zoom: 1,
    panX: 0,
    panY: 0,
    demo: null,
    lastTime: 0,
  };
  const map = $("map"),
    ctx = map.getContext("2d"),
    profile = $("profile"),
    pctx = profile.getContext("2d");
  const optical = new Image();
  optical.onload = drawMap;
  optical.onerror = () => {
    $("data-status").textContent = "Optical image unavailable · terrain loaded";
    drawMap();
  };
  optical.src = "assets/jezero/surface.jpg";
  const slopeMap = document.createElement("canvas");
  slopeMap.width = data.width;
  slopeMap.height = data.height;
  const slopeContext = slopeMap.getContext("2d");
  const pixels = slopeContext.createImageData(data.width, data.height);
  data.slopes.forEach((slope, i) => {
    const color =
      slope === null
        ? [170, 130, 200, 210]
        : slope > 28
          ? [224, 70, 54, 210]
          : slope > 15
            ? [244, 167, 75, 175]
            : [105, 164, 117, Math.max(35, slope * 7)];
    pixels.data.set(color, i * 4);
  });
  slopeContext.putImageData(pixels, 0, 0);

  function weather() {
    return Object.fromEntries(
      ["temperature", "wind", "visibility"].map((id) => [
        id,
        Number($(id).value),
      ]),
    );
  }
  function settings() {
    return Object.fromEntries(
      ["limit", "science", "reserve"].map((id) => [id, Number($(id).value)]),
    );
  }
  const minutes = (value) => Math.ceil(value);
  const distance = (value) =>
    value >= 1000
      ? (value / 1000).toFixed(2) + " km"
      : Math.round(value) + " m";
  function updateLabels() {
    $("limit-value").textContent = $("limit").value + " min";
    $("temperature-value").textContent = $("temperature").value + " °C";
    $("wind-value").textContent = $("wind").value + " m/s";
    $("visibility-value").textContent = distance(Number($("visibility").value));
  }
  function planTarget() {
    stopDemo();
    state.target = data.targets.find(
      (target) => target.id === $("target").value,
    );
    state.routes = model.plan(data, state.target);
    $("science-description").textContent = state.target.description;
    recalculate(true);
  }
  function recalculate(chooseRecommended = true) {
    stopDemo();
    updateLabels();
    state.evaluations = state.routes.map((route) =>
      model.evaluate(route, weather(), settings()),
    );
    state.recommended = model.recommend(state.evaluations);
    if (chooseRecommended && state.recommended)
      state.selected = state.recommended.id;
    if (!state.evaluations.some((route) => route.id === state.selected))
      state.selected = state.evaluations[0]?.id;
    renderResults();
    drawMap();
    drawProfile();
  }
  function renderResults() {
    const best = state.recommended;
    const direct = state.evaluations.find((route) => route.id === "direct");
    const gentle = state.evaluations.find((route) => route.id === "gentle");
    let explanation = best
      ? `${Math.floor(best.remaining)} min remain after science and return. Required reserve ${best.reserve} min.`
      : "Neither route meets the current scenario limits and required return reserve.";
    if (best && direct && gentle && best.id === "gentle") {
      explanation += ` Peak slope ${gentle.maxSlope.toFixed(1)}° versus ${direct.maxSlope.toFixed(1)}° on the short route.`;
      const timeDifference = Math.abs(gentle.total - direct.total);
      const timeLabel = timeDifference < 1 ? "under 1 min" : `${Math.ceil(timeDifference)} min`;
      explanation += ` The detour adds ${Math.round(gentle.distance - direct.distance)} m each way; round-trip time differs by ${timeLabel}.`;
    }
    $("recommendation").innerHTML =
      `<div class="recommendation ${best ? "" : "blocked"}"><h2>${best ? best.name + " recommended" : "Hold the expedition"}</h2><p>${explanation}</p></div>`;
    $("route-cards").innerHTML = state.evaluations
      .map(
        (route) =>
          `<button class="route-card ${state.selected === route.id ? "selected" : ""}" data-route="${route.id}" aria-pressed="${state.selected === route.id}"><div class="route-top"><span><i class="key ${route.id}"></i>${route.name}</span><span class="route-tag ${route.feasible ? "" : "bad"}">${route.feasible ? (best?.id === route.id ? "BEST FIT" : "WITHIN LIMITS") : "HOLD"}</span></div><div class="route-numbers"><div><strong>${distance(route.roundTripDistance)}</strong><small>there & back</small></div><div><strong>${minutes(route.total)} min</strong><small>travel + science</small></div><div><strong>${route.maxSlope.toFixed(1)}°</strong><small>maximum terrain slope</small></div><div><strong>${Math.floor(route.remaining)} min</strong><small>remaining on return</small></div></div><div class="route-notes">${Math.round(route.steepDistance)} m above 15° per leg · ${Math.round(route.ascent)} m ascent outbound<br>${route.blockers.length ? route.blockers.join(" ") : "Return reserve met under this scenario."}</div><div class="risk-line"><span>Risk index ${route.risk}/100 · ${route.riskLabel}</span><span class="risk-meter">${[0, 1, 2, 3, 4].map((i) => `<i class="${route.risk > i * 20 ? "on" : ""}"></i>`).join("")}</span></div></button>`,
      )
      .join("");
    document.querySelectorAll("[data-route]").forEach(
      (button) =>
        (button.onclick = () => {
          stopDemo();
          state.selected = button.dataset.route;
          renderResults();
          drawMap();
          drawProfile();
        }),
    );
    $("fallback").replaceChildren();
    if (!best && state.target.id !== "near") {
      const nearby = data.targets.find((target) => target.id === "near");
      const nearBest = model.recommend(
        model
          .plan(data, nearby)
          .map((route) => model.evaluate(route, weather(), settings())),
      );
      if (nearBest) {
        const text = document.createElement("p");
        text.textContent = `A nearby reconnaissance fits. ${minutes(nearBest.total)} min including science, ${Math.floor(nearBest.remaining)} min left. The science objective changes to a delta approach survey.`;
        const button = document.createElement("button");
        button.textContent = "Choose nearby survey →";
        button.onclick = () => {
          $("target").value = "near";
          planTarget();
        };
        $("fallback").append(text, button);
      } else
        $("fallback").textContent =
          "The nearby survey also fails these limits. Increase the time budget or choose milder scenario conditions.";
    }
    const selected = state.evaluations.find(
      (route) => route.id === state.selected,
    );
    $("start-demo").disabled = !selected?.feasible;
    $("export-plan").disabled = !selected;
    if (!selected) {
      $("time-bar").replaceChildren();
      $("time-breakdown").textContent =
        "No connected route through valid terrain.";
      return;
    }
    const portions = [
      [selected.outbound, "#a9d4b6"],
      [selected.science, "#e0c08a"],
      [selected.inbound, "#729a7e"],
      [Math.max(0, selected.remaining), "#495343"],
    ];
    const full = Math.max(selected.limit, selected.total);
    $("time-bar").innerHTML = portions
      .map(
        ([value, color]) =>
          `<span style="width:${(value / full) * 100}%;background:${color}"></span>`,
      )
      .join("");
    $("time-breakdown").innerHTML =
      `OUT ${minutes(selected.outbound)}m · SCIENCE ${selected.science}m · BACK ${minutes(selected.inbound)}m<br>Reserve ${Math.floor(selected.remaining)} / ${selected.reserve} min required<br>Weather speed factor ${(selected.weatherFactor * 100).toFixed(0)}% · flat baseline 0.65 m/s`;
  }

  let view = { width: 1, height: 1, scale: 1, x: 0, y: 0 };
  function sizeCanvas(canvas, context) {
    const bounds = canvas.getBoundingClientRect(),
      ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(bounds.width * ratio),
      h = Math.round(bounds.height * ratio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { width: bounds.width, height: bounds.height };
  }
  function screen(point) {
    return {
      x: view.x + point.x * view.scale,
      y: view.y + point.y * view.scale,
    };
  }
  function world(x, y) {
    return { x: (x - view.x) / view.scale, y: (y - view.y) / view.scale };
  }
  function drawMap() {
    const bounds = sizeCanvas(map, ctx);
    const scale =
      Math.min(bounds.width / data.extent, bounds.height / data.extent) *
      state.zoom;
    view = {
      ...bounds,
      scale,
      x: (bounds.width - data.extent * scale) / 2 + state.panX,
      y: (bounds.height - data.extent * scale) / 2 + state.panY,
    };
    ctx.fillStyle = "#20251f";
    ctx.fillRect(0, 0, bounds.width, bounds.height);
    if (optical.complete && optical.naturalWidth)
      ctx.drawImage(
        optical,
        view.x,
        view.y,
        data.extent * scale,
        data.extent * scale,
      );
    ctx.fillStyle = "rgba(73,66,40,.13)";
    ctx.fillRect(view.x, view.y, data.extent * scale, data.extent * scale);
    if (state.layer === "slope") {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        slopeMap,
        view.x,
        view.y,
        data.extent * scale,
        data.extent * scale,
      );
      ctx.imageSmoothingEnabled = true;
    }
    if (state.layer === "conditions") {
      const w = weather();
      ctx.fillStyle = `rgba(199,148,73,${Math.max(0, (1000 - w.visibility) / 1700)})`;
      ctx.fillRect(view.x, view.y, data.extent * scale, data.extent * scale);
      for (let y = 90; y < bounds.height - 50; y += 75)
        for (let x = 45; x < bounds.width - 30; x += 85) {
          ctx.strokeStyle = "#e5ce9a88";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 18 + w.wind, y - 10);
          ctx.lineTo(x + 12 + w.wind, y - 11);
          ctx.stroke();
        }
    }
    for (const route of [...state.evaluations].sort(
      (a, b) => (a.id === state.selected) - (b.id === state.selected),
    )) {
      ctx.beginPath();
      route.points.forEach((point, i) => {
        const p = screen(point);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      });
      ctx.lineWidth = route.id === state.selected ? 6 : 4;
      ctx.strokeStyle = "#17211fcc";
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.strokeStyle = colors[route.id];
      ctx.lineWidth = route.id === state.selected ? 3 : 2;
      ctx.setLineDash(route.id === "direct" ? [7, 5] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      if (state.layer === "slope")
        route.segments.forEach((segment, i) => {
          if (segment.slope <= 15) return;
          const a = screen(route.points[i]),
            b = screen(route.points[i + 1]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = "#ff6f57";
          ctx.lineWidth = 4;
          ctx.stroke();
        });
    }
    marker(data.base, "BASE · hypothetical", "#f4ecce", "square");
    data.targets.forEach((target) =>
      marker(
        target,
        target.id === "ridge" ? "HOGWALLOW FLATS" : "DELTA APPROACH",
        target.id === state.target.id ? "#b9e9c8" : "#e1cfaa",
        "circle",
      ),
    );
    if (state.layer === "science") {
      const skinner = {
        x:
          (77.40616768 - data.origin.lon) *
          data.metersPerDegree *
          data.cosLatitude,
        y: (data.origin.lat - 18.45889532) * data.metersPerDegree,
      };
      marker(skinner, "SKINNER RIDGE vicinity", "#f6c681", "circle", -30);
    }
    if (state.demo) {
      const route = state.evaluations.find((r) => r.id === state.selected),
        total = route.total,
        elapsed = state.demo.elapsed;
      let fraction = 0;
      if (elapsed < route.outbound) fraction = elapsed / route.outbound;
      else if (elapsed < route.outbound + route.science) fraction = 1;
      else
        fraction =
          1 - (elapsed - route.outbound - route.science) / route.inbound;
      const index = Math.min(
        route.points.length - 1,
        Math.max(0, Math.round(fraction * (route.points.length - 1))),
      );
      const p = screen(route.points[index]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#17251e";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    const scaleMetres = state.zoom >= 2 ? 50 : 200;
    $("scale-bar").style.width = scaleMetres * scale + "px";
    $("scale-label").textContent = scaleMetres + " m";
    const legends = {
      surface: "HiRISE 25 cm/px · NASA/JPL/UArizona/USGS · 900 × 900 m crop",
      slope:
        "Green ≤15° · amber 15–28° · red >28° blocked · purple no data. Sub-5 m hazards unresolved.",
      science:
        "Rover-localized science areas · exact rock positions uncertain · base & EVA tasks hypothetical",
      conditions: `Scenario across patch · ${weather().temperature} °C · ${weather().wind} m/s · visibility ${distance(weather().visibility)}. Arrows illustrate wind; direction unmodeled.`,
    };
    $("map-legend").textContent = legends[state.layer];
  }
  function marker(point, label, color, shape, offset = 0) {
    const p = screen(point);
    ctx.fillStyle = color;
    ctx.strokeStyle = "#182019";
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (shape === "square") ctx.rect(p.x - 6, p.y - 6, 12, 12);
    else ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = '10px "IBM Plex Mono",monospace';
    const width = ctx.measureText(label).width + 14;
    const x = Math.max(4, Math.min(view.width - width - 4, p.x + 13)),
      y = p.y - 16 + offset;
    ctx.fillStyle = "#16201ce8";
    ctx.fillRect(x, y, width, 23);
    ctx.fillStyle = color;
    ctx.fillText(label, x + 7, y + 15);
  }
  function drawProfile() {
    const { width, height } = sizeCanvas(profile, pctx);
    pctx.clearRect(0, 0, width, height);
    const routes = state.evaluations;
    if (!routes.length) return;
    const elevations = routes.flatMap((route) => route.points.map((p) => p.z));
    const low = Math.floor(Math.min(...elevations) / 10) * 10,
      high = Math.ceil(Math.max(...elevations) / 10) * 10 + 5,
      maxDistance = Math.max(...routes.map((r) => r.distance));
    const left = 48,
      right = 12,
      top = 16,
      bottom = 25;
    const x = (d) => left + (d / maxDistance) * (width - left - right),
      y = (z) =>
        height - bottom - ((z - low) / (high - low)) * (height - top - bottom);
    pctx.font = "9px monospace";
    for (let i = 0; i < 3; i++) {
      const z = low + ((high - low) * i) / 2;
      pctx.fillStyle = "#9aa694";
      pctx.fillText(Math.round(z) + " m", 0, y(z) + 3);
      pctx.strokeStyle = "#384035";
      pctx.beginPath();
      pctx.moveTo(left, y(z));
      pctx.lineTo(width - right, y(z));
      pctx.stroke();
    }
    routes.forEach((route) => {
      pctx.beginPath();
      route.points.forEach((p, i) => {
        i ? pctx.lineTo(x(p.distance), y(p.z)) : pctx.moveTo(x(0), y(p.z));
      });
      pctx.strokeStyle = colors[route.id];
      pctx.lineWidth = route.id === state.selected ? 2.5 : 1.3;
      pctx.setLineDash(route.id === "direct" ? [4, 3] : []);
      pctx.stroke();
      pctx.setLineDash([]);
    });
    pctx.fillStyle = "#9aa694";
    pctx.fillText("BASE / 0 m", left, height - 5);
    pctx.textAlign = "right";
    pctx.fillText(
      distance(maxDistance) + " / SCIENCE",
      width - right,
      height - 5,
    );
    pctx.textAlign = "left";
    $("profile-subtitle").textContent = "DTM 1 m → planning grid 5 m";
  }
  let drag = null;
  map.addEventListener("pointerdown", (event) => {
    drag = {
      x: event.clientX,
      y: event.clientY,
      panX: state.panX,
      panY: state.panY,
    };
    map.setPointerCapture(event.pointerId);
  });
  map.addEventListener("pointermove", (event) => {
    const rect = map.getBoundingClientRect();
    if (drag) {
      state.panX = drag.panX + event.clientX - drag.x;
      state.panY = drag.panY + event.clientY - drag.y;
      drawMap();
      $("map-tooltip").hidden = true;
      return;
    }
    const point = world(event.clientX - rect.left, event.clientY - rect.top),
      col = Math.floor(point.x / data.cellSize),
      row = Math.floor(point.y / data.cellSize);
    if (col < 0 || row < 0 || col >= data.width || row >= data.height) {
      $("map-tooltip").hidden = true;
      return;
    }
    const index = row * data.width + col,
      z = data.heights[index],
      slope = data.slopes[index];
    $("map-tooltip").textContent =
      `${(data.origin.lat - point.y / data.metersPerDegree).toFixed(5)}° N / ${(data.origin.lon + point.x / (data.metersPerDegree * data.cosLatitude)).toFixed(5)}° E · ${z === null ? "No valid DTM" : z.toFixed(1) + " m · " + slope.toFixed(1) + "° slope"} · hazards below 5 m unresolved`;
    $("map-tooltip").hidden = false;
    $("map-tooltip").style.left =
      Math.min(rect.width - 240, event.clientX - rect.left + 15) + "px";
    $("map-tooltip").style.top =
      Math.min(rect.height - 100, event.clientY - rect.top + 15) + "px";
  });
  function release(event) {
    if (!drag) return;
    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    drag = null;
    if (moved < 5) {
      const rect = map.getBoundingClientRect(),
        point = world(event.clientX - rect.left, event.clientY - rect.top);
      const target = data.targets.find(
        (t) => Math.hypot(t.x - point.x, t.y - point.y) < 20 / view.scale,
      );
      if (target) {
        $("target").value = target.id;
        planTarget();
      }
    }
  }
  map.addEventListener("pointerup", release);
  map.addEventListener("pointercancel", () => {
    drag = null;
  });
  map.addEventListener("pointerleave", () => {
    $("map-tooltip").hidden = true;
  });
  function zoom(factor) {
    state.zoom = Math.max(0.75, Math.min(8, state.zoom * factor));
    drawMap();
  }
  map.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoom(event.deltaY > 0 ? 0.85 : 1.18);
    },
    { passive: false },
  );
  map.addEventListener("keydown", (event) => {
    if (event.key === "+" || event.key === "=") zoom(1.25);
    if (event.key === "-") zoom(0.8);
  });
  $("zoom-in").onclick = () => zoom(1.3);
  $("zoom-out").onclick = () => zoom(1 / 1.3);
  $("fit-map").onclick = () => {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    drawMap();
  };
  document.querySelectorAll("[data-layer]").forEach(
    (button) =>
      (button.onclick = () => {
        state.layer = button.dataset.layer;
        document.querySelectorAll("[data-layer]").forEach((b) => {
          b.classList.toggle("active", b === button);
          b.setAttribute("aria-pressed", String(b === button));
        });
        drawMap();
      }),
  );
  const presets = {
    clear: { temperature: -35, wind: 5, visibility: 2000 },
    cold: { temperature: -85, wind: 12, visibility: 1500 },
    dust: { temperature: -60, wind: 22, visibility: 150 },
  };
  function setWeather(values, name) {
    Object.entries(values).forEach(([key, value]) => {
      $(key).value = value;
    });
    document
      .querySelectorAll("[data-preset]")
      .forEach((b) => b.classList.toggle("active", b.dataset.preset === name));
    recalculate();
  }
  document.querySelectorAll("[data-preset]").forEach(
    (button) =>
      (button.onclick = () => {
        setWeather(presets[button.dataset.preset], button.dataset.preset);
        $("scenario-note").textContent =
          "Preset scenario. Constant conditions for the entire EVA.";
      }),
  );
  $("random-weather").onclick = () => {
    const n = new Uint32Array(3);
    crypto.getRandomValues(n);
    setWeather({
      temperature: -95 + (n[0] % 86),
      wind: n[1] % 31,
      visibility: 50 + (n[2] % 60) * 50,
    });
    $("scenario-note").textContent =
      "Random scenario. Independent values for demonstration, without a climate probability model.";
  };
  ["temperature", "wind", "visibility", "limit", "science", "reserve"].forEach(
    (id) =>
      $(id).addEventListener("input", () => {
        if (["temperature", "wind", "visibility"].includes(id))
          document
            .querySelectorAll("[data-preset]")
            .forEach((b) => b.classList.remove("active"));
        recalculate();
      }),
  );
  $("target").onchange = planTarget;
  $("meda-reference").innerHTML =
    `<p><strong>${reference.temperature} °C (${reference.kelvin} K)</strong><br>${reference.sensor}<br>Sol ${reference.sol} · ${reference.lmst} LMST<br>${reference.latitude.toFixed(5)}° N, ${reference.longitude.toFixed(5)}° E</p><p>Archived sensor reading near the rover. Local rover heating may affect the measurement. Position is the last drive location. Wind and visibility remain scenario values.</p><a href="${reference.source}" target="_blank" rel="noopener">PDS calibrated record ↗</a>`;
  $("use-measured").onclick = () => {
    setWeather({ temperature: Math.round(reference.temperature) });
    $("scenario-note").textContent =
      "Scenario temperature initialized from ATS1, rounded to −35 °C. Wind and visibility are simulated.";
  };
  let animationFrame = 0;
  function stopDemo() {
    cancelAnimationFrame(animationFrame);
    if (state.demo) {
      state.demo = null;
      $("expedition").hidden = true;
      $("start-demo").textContent = "Preview expedition →";
    }
  }
  $("stop-demo").onclick = () => {
    stopDemo();
    drawMap();
  };
  $("start-demo").onclick = () => {
    const route = state.evaluations.find((r) => r.id === state.selected);
    if (!route?.feasible) return;
    stopDemo();
    state.demo = { elapsed: 0 };
    state.lastTime = performance.now();
    $("expedition").hidden = false;
    $("start-demo").textContent = "Restart preview →";
    animationFrame = requestAnimationFrame(animate);
  };
  function animate(now) {
    if (!state.demo) return;
    const route = state.evaluations.find((r) => r.id === state.selected);
    state.demo.elapsed +=
      (Math.min(0.2, (now - state.lastTime) / 1000) * route.total) / 24;
    state.lastTime = now;
    const elapsed = Math.min(route.total, state.demo.elapsed);
    const stage =
      elapsed < route.outbound
        ? "Outbound to science site"
        : elapsed < route.outbound + route.science
          ? "Science stop · document layering"
          : elapsed < route.total
            ? "Return to habitat"
            : "Back at base · expedition complete";
    $("expedition-stage").textContent = stage;
    $("expedition-progress").textContent =
      `${Math.floor(elapsed)} / ${minutes(route.total)} mission min · ${Math.floor(route.limit - elapsed)} min left · accelerated preview`;
    drawMap();
    if (elapsed < route.total) animationFrame = requestAnimationFrame(animate);
  }
  $("export-plan").onclick = () => {
    const route = state.evaluations.find((r) => r.id === state.selected);
    if (!route) return;
    const plan = {
      title: "Jezero expedition plan",
      generatedAt: new Date().toISOString(),
      target: state.target,
      base: data.base,
      weatherScenario: weather(),
      timeBudget: settings(),
      selectedRoute: route.name,
      recommended: state.recommended?.name || null,
      feasible: route.feasible,
      roundTripMetres: route.roundTripDistance,
      minutes: {
        outbound: route.outbound,
        science: route.science,
        return: route.inbound,
        remaining: route.remaining,
      },
      riskIndex: route.risk,
      reasons: route.reasons,
      waypoints: route.points.map((p) => ({
        lon: data.origin.lon + p.x / (data.metersPerDegree * data.cosLatitude),
        lat: data.origin.lat - p.y / data.metersPerDegree,
        elevation: p.z,
      })),
      sources: {
        ...data.sources,
        meda: reference.source,
        science: reference.science,
      },
      limitations:
        "Educational model. Hypothetical base and astronaut tasks. Weather uniform and constant. 5m planning grid from 1m DTM, subgrid rocks and soil unverified. Risk index is not a probability.",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "jezero-expedition.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("sources-content").innerHTML =
    `<h3>Surface and relief</h3><p>900 × 900 m crop of the USGS Mars 2020 terrain-relative-navigation HiRISE mosaic. Optical source 0.25 m/pixel; stereo DTM source 1 m/pixel. The browser uses mean elevations and maximum native terrain slopes in 5 m cells. East–west distances are corrected for latitude on a Mars sphere of radius 3,396,190 m. Pixel spacing does not establish vertical accuracy.</p><p>NASA/JPL/University of Arizona/USGS. <a href="${data.sources.optical}" target="_blank" rel="noopener">Optical source GeoTIFF</a> · <a href="${data.sources.dem}" target="_blank" rel="noopener">DTM source GeoTIFF</a></p><h3>Science and localization</h3><p>Wildcat Ridge and Skinner Ridge were investigated by Perseverance. The main objective is a proposed astronaut observation of sediment layering. Markers use rover end-drive coordinates (sol 502 for Wildcat, sol 477 for Skinner). They identify the vicinity, with unresolved exact rock positions. The alternate target uses sol 434. The habitat and walking routes are hypothetical.</p><p><a href="${reference.science}" target="_blank" rel="noopener">NASA science account</a> · <a href="${reference.waypoints}" target="_blank" rel="noopener">NASA/JPL rover waypoints</a></p><h3>MEDA archive and scenario weather</h3><p>ATS1 measured 238.57 K at sol 509, LMST 12:00:03.628, SCLK 712124800. The archive covers ${reference.utcCoverage}. This is a local sensor reading near the rover mast, potentially affected by rover heating. It is a historical reference. Wind, visibility and all future weather values are scenario assumptions, uniform across the patch and constant over the EVA. Random generation samples controls independently.</p><p>Rodriguez-Manfredi et al. / NASA PDS, DOI 10.17189/1522849. <a href="${reference.source}" target="_blank" rel="noopener">MEDA record</a> · <a href="${reference.label}" target="_blank" rel="noopener">Instrument field definitions</a></p><h3>Route and risk model</h3><p>Two 8-neighbor A* searches compare shortest 3D distance with a slope-penalized alternative. Cells above 28° and missing DTM cells are excluded. The gentler route minimizes distance × [exp(3.5 × |grade|) + 5 × (slope/28)²]. Both legs use the same corridor. Each leg has its own uphill effort and travel time.</p><p>Nominal suit speed 0.65 m/s. Terrain speed factors are exp(−3.5 × |grade|), 1/(1+slope/90), and 1/(1+1.2 × positive grade). Weather factor is 1/[1 + 0.012 × wind + 0.007 × max(0,−40−temperature) + max(0,500−visibility)/500]. These coefficients are prototype assumptions.</p><p>The risk index adds terrain (up to 43), wind (15), cold (12), visibility (20), and reserve shortage (up to 30), capped at 100. It is a comparative index, not an accident probability. Scenario holds apply at wind ≥25 m/s, visibility &lt;100 m or temperature &lt;−100 °C. These are configurable-design assumptions rather than validated suit limits.</p><p>A route qualifies only when travel + science + required reserve fits the time budget and scenario holds are absent. The lowest risk qualifying route is recommended, with time breaking ties. A nearby target is offered only if its own route qualifies.</p><h3>Unresolved information</h3><p>The 5 m planning grid cannot resolve individual boulders, soil bearing strength or metre-scale obstacles. All routes require field verification. Purple cells in the slope layer identify missing elevations where present. Weather is measured at one historical rover location, so no spatial weather field is inferred. Radiation, suit consumables and rescue logistics are outside this prototype.</p>`;
  $("sources-open").onclick = () => $("sources").showModal();
  $("sources-close").onclick = () => $("sources").close();
  $("data-status").textContent = "HiRISE 25 cm · DTM 1 m\nLOCAL DATA READY";
  window.addEventListener("resize", () => {
    drawMap();
    drawProfile();
  });
  window.__jezero = {
    state,
    weather,
    settings,
    recalculate,
    planTarget,
    model,
    data,
  };
  planTarget();
})();
