"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const data = window.VALLES;
  const model = window.VallesModel;
  if (!data || !model) {
    $("data-status").textContent = "Terrain failed to load";
    $("recommendation").textContent =
      "Keep this HTML file with its assets and js folders, then reload.";
    $("start-demo").disabled = true;
    return;
  }
  const weatherIds = [
    "temperature",
    "wind",
    "visibility",
    "direction",
    "severity",
    "stormX",
    "stormY",
    "stormRadius",
  ];
  let scenario = MarsWeather.load(),
    routeKey = "",
    fieldKey = "",
    terrain3d = null,
    savedScenario = null;
  for (const id of weatherIds) $(id).value = scenario[id];
  for (const target of data.targets) {
    const option = document.createElement("option");
    option.value = target.id;
    option.textContent = target.name;
    $("target").append(option);
  }
  const colors = { direct: "#ffb777", gentle: "#b2e4c1" };
  const state = {
    target: data.targets[0],
    hazards: MarsHazards.load(),
    hazardLayer: "hazards",
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
    view: "3d",
    field: null,
    picking: null,
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
  optical.src = window.VALLES_SURFACE || "assets/valles/surface.jpg";
  const slopeMap = document.createElement("canvas");
  slopeMap.width = data.width;
  slopeMap.height = data.height;
  const slopeContext = slopeMap.getContext("2d");
  const pixels = slopeContext.createImageData(data.width, data.height);
  data.slopes.forEach((slope, i) => {
    pixels.data.set(MarsLayerLegend.slopeColor(slope), i * 4);
  });
  slopeContext.putImageData(pixels, 0, 0);

  function weather() {
    return MarsWeather.normalize({
      ...scenario,
      ...Object.fromEntries(weatherIds.map((id) => [id, Number($(id).value)])),
    });
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
    for (const id of [
      "direction",
      "severity",
      "stormX",
      "stormY",
      "stormRadius",
    ])
      $(id + "-value").textContent =
        id === "direction"
          ? $(id).value + "°"
          : Math.round(Number($(id).value) * 100) + "%";
    $("scenario-note").textContent =
      `Scenario seed ${scenario.seed}. Wind is modified by upwind terrain; dust varies across the patch. No local weather measurements.`;
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
    $("science-description").textContent = state.target.description;
    recalculate(true);
  }
  function recalculate(chooseRecommended = true) {
    stopDemo();
    scenario = MarsWeather.save(weather());
    const wk = JSON.stringify([scenario, data.base, state.hazards]);
    if (wk !== fieldKey) {
      state.field = MarsWeather.localField(data, scenario, state.hazards);
      fieldKey = wk;
    }
    const key = wk + JSON.stringify(state.target);
    if (key !== routeKey) {
      state.routes = model.plan(data, state.target, scenario, state.field);
      routeKey = key;
    }
    updateLabels();
    state.evaluations = state.routes.map((route) =>
      model.evaluate(route, weather(), settings(), state.field),
    );
    state.recommended = model.recommend(state.evaluations);
    if (chooseRecommended && state.recommended)
      state.selected = state.recommended.id;
    if (!state.evaluations.some((route) => route.id === state.selected))
      state.selected = state.evaluations[0]?.id;
    renderResults();
    renderComparison();
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
      const timeLabel =
        timeDifference < 1 ? "under 1 min" : `${Math.ceil(timeDifference)} min`;
      explanation += ` The detour adds ${Math.round(gentle.distance - direct.distance)} m each way; round-trip time differs by ${timeLabel}.`;
    }
    $("recommendation").innerHTML =
      `<div class="recommendation ${best ? "" : "blocked"}"><h2>${best ? best.name + " recommended" : "Hold the expedition"}</h2><p>${explanation}</p></div>`;
    $("route-cards").innerHTML = state.evaluations
      .map(
        (route) =>
          `<button class="route-card ${state.selected === route.id ? "selected" : ""}" data-route="${route.id}" aria-pressed="${state.selected === route.id}"><div class="route-top"><span><i class="key ${route.id}"></i>${route.name}</span><span class="route-tag ${route.feasible ? "" : "bad"}">${route.feasible ? (best?.id === route.id ? "BEST FIT" : "WITHIN LIMITS") : "HOLD"}</span></div><div class="route-numbers"><div><strong>${distance(route.roundTripDistance)}</strong><small>there & back</small></div><div><strong>${minutes(route.total)} min</strong><small>travel + science</small></div><div><strong>${route.maxSlope.toFixed(1)}°</strong><small>maximum terrain slope</small></div><div><strong>${Math.floor(route.remaining)} min</strong><small>remaining on return</small></div></div><div class="route-notes">Generated hazard peak ${Math.round(route.hazardPeak * 100)}/100 · ${Math.round(route.hazardDistance)} m in closed cells<br>${Math.round(route.steepDistance)} m above 15° per leg · ${Math.round(route.ascent)} m ascent outbound<br>${route.blockers.length ? route.blockers.join(" ") : "Return reserve met under this scenario."}</div><div class="risk-line"><span>Risk index ${route.risk}/100 · ${route.riskLabel}</span><span class="risk-meter">${[0, 1, 2, 3, 4].map((i) => `<i class="${route.risk > i * 20 ? "on" : ""}"></i>`).join("")}</span></div></button>`,
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
    $("hazard-status").textContent =
      `${state.hazards.enabled ? "Generated hazards active" : "Generated hazards disabled"} · seed ${state.hazards.seed}. ` +
      (state.hazards.enabled && state.hazards.solar >= 0.7
        ? "Solar alert: shelter and wait; no geographic detour clears this hold."
        : "Colored fields are simulated, not surveyed obstacles.");
    $("fallback").replaceChildren();
    if (!best && state.target.id !== "near") {
      const nearby = data.targets.find((target) => target.id === "near");
      const nearBest = model.recommend(
        model
          .plan(data, nearby, weather(), state.field)
          .map((route) =>
            model.evaluate(route, weather(), settings(), state.field),
          ),
      );
      if (nearBest) {
        const text = document.createElement("p");
        text.textContent = `A nearby reconnaissance fits. ${minutes(nearBest.total)} min including science, ${Math.floor(nearBest.remaining)} min left. The science objective changes to a canyon-floor reconnaissance.`;
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
      `OUT ${minutes(selected.outbound)}m · SCIENCE ${selected.science}m · BACK ${minutes(selected.inbound)}m<br>Reserve ${Math.floor(selected.remaining)} / ${selected.reserve} min required<br>Conditions speed factor ${(selected.weatherFactor * 100).toFixed(0)}% · flat baseline 0.65 m/s`;
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
    terrain3d?.update(state);
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
    $("local-hazard-layer").hidden = state.layer !== "hazards";
    if (state.layer === "hazards" && state.field)
      ctx.drawImage(
        hazardCanvas(),
        view.x,
        view.y,
        data.extent * scale,
        data.extent * scale,
      );
    if (state.layer === "conditions" && state.field) {
      const wc = conditionCanvas();
      ctx.drawImage(
        wc,
        view.x,
        view.y,
        data.extent * scale,
        data.extent * scale,
      );
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
        target.name.toUpperCase(),
        target.id === state.target.id ? "#b9e9c8" : "#e1cfaa",
        "circle",
      ),
    );
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
      surface: "HiRISE · NASA/JPL/UArizona/USGS · Southwest Candor",
      slope:
        "Green ≤15° · amber 15–28° · red >28° blocked · purple no data. Sub-5 m hazards unresolved.",
      science:
        "Proposed observation sites · investigate layering and access · base & science tasks hypothetical",
      conditions: `Scenario across patch · ${weather().temperature} °C · ${weather().wind} m/s · visibility ${distance(weather().visibility)}. Amber = modeled dust and wind exposure; upwind terrain changes local wind.`,
    };
    MarsLayerLegend.local($("map-legend"), state.layer,
      state.layer === "hazards" ? `Scenario seed ${state.hazards.seed}` : legends[state.layer],
      state.hazardLayer, state.hazards.enabled);
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
    $("profile-subtitle").textContent =
      `DTM ${data.nativeDemResolution.toFixed(2)} m → route grid ${data.cellSize} m · relief ×1`;
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
      `${(data.origin.lat - point.y / data.metersPerDegree).toFixed(5)}° N / ${(data.origin.lon + point.x / (data.metersPerDegree * data.cosLatitude)).toFixed(5)}° E · ${z === null ? "No valid DTM" : z.toFixed(1) + " m · " + slope.toFixed(1) + "° slope"} · hazards below ${data.cellSize} m unresolved`;
    const local = state.field?.cells[index];
    if (local)
      $("map-tooltip").textContent +=
        ` · scenario wind ${local.wind.toFixed(1)} m/s · visibility ${Math.round(local.visibility)} m`;
    if (local && state.field.hazards)
      $("map-tooltip").textContent +=
        " · " + MarsHazards.description(state.field.hazards, index, local);
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
      if (state.picking) {
        pickPoint(point);
        return;
      }
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
    if (state.view === "3d") {
      terrain3d?.zoom(factor);
      return;
    }
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
    terrain3d?.fit();
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
    clear: { temperature: -35, wind: 4, visibility: 3000, severity: 0 },
    cold: { temperature: -85, wind: 12, visibility: 2000, severity: 0.2 },
    dust: {
      temperature: -55,
      wind: 17,
      visibility: 1800,
      severity: 1,
      stormX: 0.5,
      stormY: 0.5,
      stormRadius: 0.2,
    },
  };
  function setWeather(values, name) {
    scenario = MarsWeather.normalize({ ...scenario, ...values });
    for (const id of weatherIds) $(id).value = scenario[id];
    document
      .querySelectorAll("[data-preset]")
      .forEach((b) => b.classList.toggle("active", b.dataset.preset === name));
    recalculate();
  }
  document
    .querySelectorAll("[data-preset]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          setWeather(presets[b.dataset.preset], b.dataset.preset)),
    );
  $("random-weather").onclick = () => setWeather(MarsWeather.generate());
  let pending = 0;
  for (const id of [...weatherIds, "limit", "science", "reserve"])
    $(id).addEventListener("input", () => {
      document
        .querySelectorAll("[data-preset]")
        .forEach((b) => b.classList.remove("active"));
      updateLabels();
      clearTimeout(pending);
      pending = setTimeout(() => recalculate(), 100);
    });
  $("target").onchange = planTarget;
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
      title: "Valles Marineris expedition plan",
      generatedAt: new Date().toISOString(),
      target: state.target,
      base: data.base,
      weatherScenario: weather(),
      hazardScenario: state.hazards,
      hazardPeaks: route.hazardPeaks,
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
      },
      limitations:
        "Educational model. Hypothetical base and astronaut tasks. Weather is a spatial scenario, constant in time; terrain shelter is heuristic. 5m planning grid from ~1m DTM, subgrid rocks and soil unverified. Risk index is not a probability.",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "valles-expedition.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("sources-content").innerHTML =
    `<h3>Real terrain · Southwest Candor</h3><p>A ${data.extent} × ${data.extent} m patch inside Valles Marineris. HiRISE stereo DTM ${data.nativeDemResolution.toFixed(3)} m/pixel, orthophoto source ${data.opticalResolution.toFixed(3)} m/pixel. The display image is reduced to about ${data.displayImageResolution?.toFixed(2) || "1"} m/pixel. Walking search uses ${data.cellSize} m cells. Pixel spacing is not a statement of vertical accuracy. The 3D map uses true vertical scale ×1; routes follow the sampled terrain.</p><p>NASA/JPL/University of Arizona/USGS. <a href="${data.sources.dem}" target="_blank" rel="noopener">DTM</a> · <a href="${data.sources.optical}" target="_blank" rel="noopener">Orthophoto</a></p><h3>Proposed exploration, not an established habitat</h3><p>The base and science destinations are proposed scenario locations. No astronaut or rover observations are claimed here. Investigate visible layering and surface geometry. Orbital hydrogen detections in the broader canyon system motivate water research, but do not establish accessible water, stable terrain or habitability at this patch.</p><p><a href="https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Exploration/ExoMars/ExoMars_discovers_hidden_water_in_Mars_Grand_Canyon" target="_blank" rel="noopener">ESA · regional hydrogen / water interpretation</a></p><h3>Spatial weather scenario</h3><p>Manual controls or a reproducible seeded generator set background temperature, wind direction/speed, visibility, and a Gaussian dust plume. Wind is modified by upwind relief sampled at 30, 60, 120 and 200 m. This is an exposure heuristic, not a validated canyon circulation simulation. Temperature changes by an assumed −4 °C/km from the base elevation. No weather station measurements exist in this prototype at Candor. The field is held constant during an expedition.</p><h3>Route and risk model</h3><p>8-neighbour A* compares the shortest 3D distance with a weather-adapted path. Invalid cells and slopes above 28° are excluded; diagonal corner cutting is blocked. The adapted path also excludes local wind ≥30 m/s, visibility below 100 m and temperature below −100 °C. These are scenario limits, not validated suit operating limits.</p><p>Each segment has separate outward and return times from a 0.65 m/s flat baseline, exp(3.5 × absolute grade), slope and uphill factors, and a shared weather penalty. The adapted search minimizes round-trip time weighted by local dust, wind and terrain exposure; the displayed assessment uses exactly the same segment model. Both legs follow the same corridor. A route qualifies only if travel, science and reserve fit the budget. Risk is a comparative index, not an accident probability.</p><h3>Unresolved hazards</h3><p>Boulders, soil strength, unstable rock, consumables and rescue logistics are unverified. Features below the ${data.cellSize} m route grid remain unresolved. This small crop does not represent the entire Valles Marineris system; use the planet view for regional context.</p>`;
  $("sources-content").insertAdjacentHTML(
    "beforeend",
    MarsHazards.evidenceHtml(),
  );
  $("sources-open").onclick = () => $("sources").showModal();
  $("sources-close").onclick = () => $("sources").close();
  $("data-status").textContent =
    `HiRISE ${data.opticalResolution.toFixed(2)} m · DTM ${data.nativeDemResolution.toFixed(2)} m · ${data.extent / 1000} km patch`;
  window.addEventListener("resize", () => {
    drawMap();
    drawProfile();
  });
  window.__valles = {
    state,
    weather,
    settings,
    recalculate,
    planTarget,
    model,
    data,
    setWeather,
    pickPoint,
    setHazards,
    get terrain3d() {
      return terrain3d;
    },
  };
  let conditionCache = null,
    conditionField = null;
  function conditionCanvas() {
    if (conditionField === state.field) return conditionCache;
    const c = document.createElement("canvas");
    c.width = data.width;
    c.height = data.height;
    const cx = c.getContext("2d"),
      im = cx.createImageData(data.width, data.height);
    state.field.cells.forEach((w, i) => {
      im.data.set(MarsLayerLegend.conditionsColor(w), i * 4);
    });
    cx.putImageData(im, 0, 0);
    conditionField = state.field;
    conditionCache = c;
    return c;
  }
  let hazardCache = null,
    hazardCacheField = null,
    hazardCacheLayer = "";
  function hazardCanvas() {
    if (
      hazardCacheField === state.field &&
      hazardCacheLayer === state.hazardLayer
    )
      return hazardCache;
    const c = document.createElement("canvas");
    c.width = data.width;
    c.height = data.height;
    const cx = c.getContext("2d"),
      im = cx.createImageData(data.width, data.height);
    for (let i = 0; i < data.heights.length; i++)
      if (state.field.cells[i])
        im.data.set(
          MarsHazards.rgba(
            state.field.hazards,
            i,
            state.field.cells[i],
            state.hazardLayer,
          ),
          i * 4,
        );
    cx.putImageData(im, 0, 0);
    hazardCache = c;
    hazardCacheField = state.field;
    hazardCacheLayer = state.hazardLayer;
    return c;
  }
  $("local-hazard-layer").onchange = () => {
    state.hazardLayer = $("local-hazard-layer").value;
    drawMap();
  };
  function setHazards(config) {
    state.hazards = MarsHazards.save(config);
    state.layer = "hazards";
    document
      .querySelectorAll("[data-layer]")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.layer === "hazards"),
      );
    recalculate();
  }
  function tripKey() {
    return JSON.stringify([data.base, state.target, settings()]);
  }
  function renderComparison() {
    const box = $("comparison");
    if (!savedScenario) return;
    if (savedScenario.trip !== tripKey()) {
      box.textContent =
        "Destination, base or budget changed. Save a new baseline for this trip.";
      return;
    }
    const now =
        state.recommended ||
        state.evaluations.find((r) => r.id === state.selected),
      old = savedScenario.route;
    if (!now) {
      box.textContent = "The new scenario has no connected route.";
      return;
    }
    const delta = (v) => (v >= 0 ? "+" : "") + v.toFixed(1);
    box.innerHTML = `<p>Hazard seed ${savedScenario.hazards?.seed} → ${state.hazards.seed}</p><p>Saved ${savedScenario.weather.wind} m/s, ${savedScenario.weather.temperature} °C → now ${weather().wind} m/s, ${weather().temperature} °C</p><table><tr><th></th><th>Saved</th><th>Now</th></tr><tr><td>Round trip</td><td>${Math.round(old.roundTripDistance)} m</td><td>${Math.round(now.roundTripDistance)} m</td></tr><tr><td>Total</td><td>${minutes(old.total)} min</td><td>${minutes(now.total)} min</td></tr><tr><td>Remaining</td><td>${Math.floor(old.remaining)} min</td><td>${Math.floor(now.remaining)} min</td></tr><tr><td>Risk index</td><td>${old.risk}</td><td>${now.risk}</td></tr></table><p>${delta(now.total - old.total)} min · ${delta(now.roundTripDistance - old.roundTripDistance)} m · ${now.feasible ? "reserve met" : "HOLD"}</p>`;
  }
  $("save-scenario").onclick = () => {
    const route =
      state.recommended ||
      state.evaluations.find((r) => r.id === state.selected);
    if (!route) return;
    savedScenario = {
      weather: weather(),
      hazards: JSON.parse(JSON.stringify(state.hazards)),
      route: JSON.parse(JSON.stringify(route)),
      trip: tripKey(),
    };
    $("restore-scenario").hidden = false;
    renderComparison();
  };
  $("restore-scenario").onclick = () => {
    if (savedScenario) {
      state.hazards = MarsHazards.save(savedScenario.hazards);
      setWeather(savedScenario.weather);
    }
  };
  function armPick(kind) {
    state.picking = state.picking === kind ? null : kind;
    $("pick-status").textContent = state.picking
      ? "Click terrain to set " + state.picking + " · Esc cancels"
      : "";
    for (const k of ["base", "target"])
      $("pick-" + k).classList.toggle("armed", state.picking === k);
  }
  $("pick-base").onclick = () => armPick("base");
  $("pick-target").onclick = () => armPick("target");
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      state.picking = null;
      armPick(null);
    }
  });
  function pickPoint(point) {
    const i = model.cellIndex(data, point);
    if (
      i < 0 ||
      !Number.isFinite(data.heights[i]) ||
      data.slopes[i] > model.MAX_SLOPE
    ) {
      $("pick-status").textContent = "Choose valid terrain at or below 28°.";
      return;
    }
    const snapped = {
      x: ((i % data.width) + 0.5) * data.cellSize,
      y: (Math.floor(i / data.width) + 0.5) * data.cellSize,
    };
    snapped.lon =
      data.origin.lon + snapped.x / (data.metersPerDegree * data.cosLatitude);
    snapped.lat = data.origin.lat - snapped.y / data.metersPerDegree;
    if (state.picking === "base") Object.assign(data.base, snapped);
    else {
      let t = data.targets.find((t) => t.id === "custom");
      if (!t) {
        t = {
          id: "custom",
          name: "Custom science waypoint",
          description:
            "User-selected candidate. Examine local layering and terrain; scientific value and access require verification.",
        };
        data.targets.push(t);
        const o = document.createElement("option");
        o.value = t.id;
        o.textContent = t.name;
        $("target").append(o);
      }
      Object.assign(t, snapped);
      $("target").value = t.id;
    }
    state.picking = null;
    armPick(null);
    planTarget();
  }
  function setView(mode) {
    state.view = mode;
    $("terrain-3d").hidden = mode !== "3d";
    $("map").style.visibility = mode === "3d" ? "hidden" : "visible";
    document.querySelector(".map-scale").hidden = mode === "3d";
    document.querySelector(".north").hidden = mode === "3d";
    for (const m of ["2d", "3d"])
      $("view-" + m).classList.toggle("active", m === mode);
    terrain3d?.resize();
    drawMap();
  }
  try {
    terrain3d = Valles3D.create({
      container: $("terrain-3d"),
      data,
      optical,
      pick: (point) => {
        if (state.picking) pickPoint(point);
      },
      probe: (point) => {
        const i = model.cellIndex(data, point),
          w = state.field?.cells[i];
        if (!w) return;
        $("map-tooltip").textContent =
          `${data.heights[i].toFixed(1)} m · ${data.slopes[i].toFixed(1)}° slope · scenario wind ${w.wind.toFixed(1)} m/s · visibility ${Math.round(w.visibility)} m`;
        if (state.field.hazards)
          $("map-tooltip").textContent +=
            " · " + MarsHazards.description(state.field.hazards, i, w);
        $("map-tooltip").style.left = "16px";
        $("map-tooltip").style.top = "110px";
        $("map-tooltip").hidden = false;
      },
      clearProbe: () => ($("map-tooltip").hidden = true),
      conditionCanvas,
      hazardCanvas,
      slopeMap,
    });
  } catch (error) {
    $("view-3d").disabled = true;
    $("view-3d").textContent = "3D unavailable";
    state.view = "2d";
    console.warn(error);
  }
  $("view-3d").onclick = () => setView("3d");
  $("view-2d").onclick = () => setView("2d");
  document.addEventListener("click", (event) => {
    const a = event.target.closest('a[href^="index.html"]');
    if (a)
      a.href =
        "index.html?weather=" +
        encodeURIComponent(JSON.stringify(weather())) +
        "&hazards=" +
        encodeURIComponent(JSON.stringify(state.hazards));
  });
  $("focus-route").onclick = () => {
    setView("3d");
    terrain3d?.focusRoute();
  };
  MarsHazardUI.mount({
    button: "hazards-open",
    scope: "local",
    read: () => state.hazards,
    apply: setHazards,
    locate: () => {
      const route =
        state.routes.find((r) => r.id === "direct") || state.routes[0];
      const point =
        route?.points[Math.floor(route.points.length / 2)] || state.target;
      return { x: point.x / data.extent, y: point.y / data.extent };
    },
  });
  setView(state.view);
  planTarget();
})();
