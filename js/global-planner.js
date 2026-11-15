"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const globe = window.__globe;
  const { THREE } = window;
  const engine = globe.engine;
  const catalogue = window.MARS_STORMS;
  const state = {
    result: null,
    weather: MarsWeather.load(),
    hazards: MarsHazards.load(),
    saved: null,
    selected: "aware",
    mode: "regions",
    picking: null,
    from: null,
    to: null,
    following: false,
    frame: 0,
  };
  const colors = { short: 0xf5b47d, aware: 0x9de7bf };
  const routeNames = {
    short: "Shortest surface path",
    aware: "Adaptive path",
  };
  const routesGroup = new THREE.Group();
  globe.planet.add(routesGroup);
  const overlayMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const overlay = new THREE.Mesh(globe.terrainGeometry, overlayMaterial);
  overlay.scale.setScalar(1.0003);
  overlay.visible = false;
  globe.planet.add(overlay);
  const stormGroup = new THREE.Group();
  globe.planet.add(stormGroup);
  const points = [
    {
      id: "valles-site",
      name: "Valles · detailed Candor site",
      lat: window.VALLES_SITE.center.lat,
      lon: window.VALLES_SITE.center.lon,
    },
    ...globe.MISSIONS.map((m) => ({
      id: "mission-" + m.id,
      name: m.name + " · " + m.site,
      lat: m.lat,
      lon: m.lon,
    })),
    ...[
      "Jezero",
      "Hellas Planitia",
      "Olympus Mons",
      "Utopia Planitia",
      "Valles Marineris",
    ].map((name) => {
      const r = globe.regions.find((r) => r.name === name);
      return { id: "region-" + r.id, name: r.name, lat: r.lat, lon: r.lon };
    }),
  ];
  for (const id of ["route-from", "route-to"]) {
    for (const point of points) {
      const option = document.createElement("option");
      option.value = point.id;
      option.textContent = point.name;
      $(id).append(option);
    }
    $(id).addEventListener("change", () => {
      state[id === "route-from" ? "from" : "to"] = resolvePoint(id);
      invalidateRoute();
    });
  }
  $("route-from").value = "mission-curiosity";
  $("route-to").value = "valles-site";
  state.from = resolvePoint("route-from");
  state.to = resolvePoint("route-to");
  function resolvePoint(id) {
    return points.find((point) => point.id === $(id).value);
  }
  function options() {
    return {
      weather: state.weather,
      hazards: state.hazards,
      ls: Number($("planet-season").value),
      dustWeight: Number($("dust-weight").value),
      radiationWeight: Number($("radiation-weight").value),
      speed: Number($("travel-speed").value),
      hoursPerSol: Number($("travel-hours").value),
    };
  }
  function clearGroup(group) {
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
    }
  }
  function stopFollow() {
    cancelAnimationFrame(state.frame);
    if (state.followMarker) {
      routesGroup.remove(state.followMarker);
      state.followMarker.geometry.dispose();
      state.followMarker.material.dispose();
      state.followMarker = null;
      globe.markDirty();
    }
    state.following = false;
    $("follow-global").textContent = "Follow selected route →";
  }
  function cancelPicking() {
    state.picking = null;
    globe.setPicker(null);
    $("global-report").hidden = state.mode !== "routes" || !state.result;
    $("route-pick-status").textContent = "";
    document
      .querySelectorAll(".pick-point")
      .forEach((b) => b.classList.remove("armed"));
  }
  function setPanelsHidden(hidden) {
    document.body.classList.toggle("panels-hidden", hidden);
    $("toggle-global-panels").textContent = hidden
      ? "Show panels"
      : "Hide panels";
    $("toggle-global-panels").setAttribute("aria-pressed", String(hidden));
  }
  $("toggle-global-panels").onclick = () =>
    setPanelsHidden(!document.body.classList.contains("panels-hidden"));
  function invalidateRoute() {
    stopFollow();
    state.result = null;
    $("global-report").hidden = true;
    clearGroup(routesGroup);
    drawEndpoints();
    globe.markDirty();
  }
  function drawEndpoints() {
    for (const [key, point] of [
      ["from", state.from],
      ["to", state.to],
    ]) {
      if (!point) continue;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.007, 12, 8),
        new THREE.MeshBasicMaterial({
          color: key === "from" ? 0xffffff : 0x9de7bf,
        }),
      );
      marker.position.copy(globe.positionAt(point.lat, point.lon, 0.006));
      routesGroup.add(marker);
    }
  }
  function chooseOnGlobe(key) {
    globe.setMapMode("routes");
    cancelPicking();
    state.picking = key;
    if (matchMedia("(max-width:700px)").matches) setPanelsHidden(true);
    $("global-report").hidden = true;
    $("pick-" + key).classList.add("armed");
    $("route-pick-status").textContent =
      "Click the 3D surface to set " +
      (key === "from" ? "departure" : "destination") +
      ". Drag to rotate; scroll to zoom.";
    globe.setPicker((point) => {
      const id = "custom-" + key;
      let existing = points.find((p) => p.id === id);
      const label = `Picked ${point.lat.toFixed(2)}°, ${point.lon.toFixed(2)}°`;
      if (existing) Object.assign(existing, point, { name: label });
      else {
        existing = { id, name: label, ...point };
        points.push(existing);
        const option = document.createElement("option");
        option.value = id;
        $("route-" + key).append(option);
      }
      const option = $("route-" + key).querySelector(`option[value="${id}"]`);
      option.textContent = label;
      $("route-" + key).value = id;
      state[key] = existing;
      setPanelsHidden(false);
      cancelPicking();
      invalidateRoute();
    });
  }
  $("pick-from").onclick = () => chooseOnGlobe("from");
  $("pick-to").onclick = () => chooseOnGlobe("to");
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      cancelPicking();
      stopFollow();
    }
  });
  window.addEventListener("mars-mode", (event) => {
    state.mode = event.detail;
    setPanelsHidden(false);
    cancelPicking();
    stopFollow();
    $("global-report").hidden = state.mode !== "routes" || !state.result;
    routesGroup.visible = state.mode === "routes";
  });
  routesGroup.visible = false;

  function calculate() {
    cancelPicking();
    stopFollow();
    if (
      !$("travel-speed").reportValidity() ||
      !$("travel-hours").reportValidity()
    )
      return;
    $("plan-global").disabled = true;
    $("plan-global").textContent = "Calculating…";
    try {
      state.result = engine.plan(state.from, state.to, options());
      state.selected = state.result.recommendedId || "short";
      renderResults();
      drawRoutes();
      const route = state.result.routes.find(
        (route) => route.id === state.selected,
      );
      const middle = route.points[Math.floor(route.points.length / 2)];
      globe.focusLocation(middle.lat, middle.lon, 3.2);
    } catch (error) {
      state.result = null;
      $("global-report").hidden = false;
      $("global-summary").textContent = error.message;
      $("global-route-cards").replaceChildren();
      drawProfile();
      clearGroup(routesGroup);
      $("follow-global").disabled = true;
      $("export-global").disabled = true;
    } finally {
      $("plan-global").disabled = false;
      $("plan-global").textContent = "Compare routes →";
    }
  }
  $("plan-global").onclick = calculate;
  $("clear-global").onclick = () => {
    cancelPicking();
    invalidateRoute();
  };
  for (const id of ["dust-weight", "radiation-weight"])
    $(id).addEventListener("input", () => {
      $(id + "-value").textContent = $(id).value;
      invalidateRoute();
    });
  for (const id of ["travel-speed", "travel-hours"])
    $(id).addEventListener("input", invalidateRoute);
  function renderResults() {
    const result = state.result;
    if (!result) return;
    $("global-report").hidden = state.mode !== "routes";
    const best = result.routes.find((r) => r.id === result.recommendedId);
    const short = result.routes.find((r) => r.id === "short");
    $("global-summary").textContent = best
      ? `${routeNames[best.id]} has the lowest weighted cost. ${Math.round(best.distanceKm - short.distanceKm).toLocaleString("en")} km extra versus the shortest path. One-way vehicle scenario; weather and season held constant.`
      : "No route meets this scenario. " +
        (result.routes[0]?.blockers.join(" ") ||
          "Check elevation and operating limits.");
    $("global-route-cards").innerHTML = result.routes
      .map(
        (route) =>
          `<button class="global-route-card ${state.selected === route.id ? "selected" : ""}" data-global-route="${route.id}" aria-pressed="${state.selected === route.id}"><span>${routeNames[route.id]} ${route.id === result.recommendedId ? "· BEST COST" : ""}</span><strong>${Math.round(route.distanceKm).toLocaleString("en")} km <small>${route.sols.toFixed(1)} sols</small></strong><p>Historical dust index ${route.dustExposure === null ? "unknown" : (route.dustExposure * 100).toFixed(1) + "/100"} · radiation proxy ${route.radiationExposure?.toFixed(2) ?? "unknown"}×</p><p>Scenario wind ≤${route.maxWind.toFixed(1)} m/s · visibility ≥${Math.round(route.minVisibility)} m${route.feasible ? "" : " · HOLD"}</p><p>Generated hazards ${Math.round(route.hazardPeak * 100)}/100 peak · ${Math.round(route.hazardBlockedKm)} km in closed cells</p>${route.blockers.length ? `<p class="hazard-status"><strong>${route.blockers.join(" ")}</strong></p>` : ""}<p>Peak elevation ${route.maxElevation === null ? "unknown" : (route.maxElevation / 1000).toFixed(1) + " km"} · weighted cost ${route.score === null ? "unknown" : Math.round(route.score).toLocaleString("en")}</p></button>`,
      )
      .join("");
    document.querySelectorAll("[data-global-route]").forEach(
      (button) =>
        (button.onclick = () => {
          stopFollow();
          state.selected = button.dataset.globalRoute;
          renderResults();
          drawRoutes();
        }),
    );
    const route = result.routes.find((route) => route.id === state.selected);
    $("follow-global").disabled = route.distanceKm === 0 || !route.feasible;
    $("export-global").disabled = !route.elevationComplete;
    $("global-follow-status").textContent =
      result.selectedEvents +
      " historical detections in this season across the catalogue. Low counts can reflect sparse observation coverage.";
    renderComparison();
    drawProfile();
  }
  function densePoints(points) {
    const result = [];
    for (let i = 0; i < points.length; i++) {
      if (i === 0) {
        result.push(points[i]);
        continue;
      }
      const a = points[i - 1],
        b = points[i];
      const va = globe.positionAt(a.lat, a.lon).normalize(),
        vb = globe.positionAt(b.lat, b.lon).normalize();
      const angle = va.angleTo(vb),
        steps = Math.max(1, Math.ceil(angle / (Math.PI / 720)));
      const rotation = new THREE.Quaternion().setFromUnitVectors(va, vb);
      for (let step = 1; step <= steps; step++) {
        const v = va
          .clone()
          .applyQuaternion(
            new THREE.Quaternion().slerp(rotation, step / steps),
          );
        result.push({
          lat: (Math.asin(v.y) * 180) / Math.PI,
          lon: (Math.atan2(-v.z, v.x) * 180) / Math.PI,
        });
      }
    }
    return result;
  }
  function drawRoutes() {
    clearGroup(routesGroup);
    if (state.result) {
      for (const route of state.result.routes) {
        const path = densePoints(route.points).map((p) =>
          globe.positionAt(
            p.lat,
            p.lon,
            route.id === state.selected ? 0.004 : 0.003,
          ),
        );
        if (path.length > 1) {
          const curve = new THREE.CatmullRomCurve3(path);
          const geometry = new THREE.TubeGeometry(
            curve,
            Math.max(2, path.length * 2),
            route.id === state.selected ? 0.0018 : 0.0011,
            5,
            false,
          );
          const line = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
              color: colors[route.id],
              transparent: true,
              opacity: route.id === state.selected ? 1 : 0.75,
            }),
          );
          routesGroup.add(line);
        }
      }
    }
    drawEndpoints();
    globe.markDirty();
  }
  function drawProfile() {
    const canvas = $("global-profile"),
      ctx = canvas.getContext("2d");
    const width = Math.max(250, canvas.clientWidth),
      height = 135;
    canvas.width = width * 2;
    canvas.height = height * 2;
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, width, height);
    if (!state.result) return;
    const routes = state.result.routes;
    const values = routes
      .flatMap((r) => r.points.map((p) => p.elevation))
      .filter(Number.isFinite);
    if (!values.length) return;
    const min = Math.floor(Math.min(...values) / 1000) * 1000,
      max = Math.ceil(Math.max(...values) / 1000) * 1000 + 500;
    const longest = Math.max(1, ...routes.map((r) => r.distanceKm));
    const x = (d) => 39 + (d / longest) * (width - 49),
      y = (z) => 108 - ((z - min) / (max - min)) * 90;
    ctx.font = "9px monospace";
    ctx.fillStyle = "#b8b3a2";
    for (let i = 0; i < 3; i++) {
      const z = min + ((max - min) * i) / 2;
      ctx.fillText((z / 1000).toFixed(1) + " km", 0, y(z) + 3);
      ctx.strokeStyle = "#343837";
      ctx.beginPath();
      ctx.moveTo(39, y(z));
      ctx.lineTo(width - 5, y(z));
      ctx.stroke();
    }
    for (const route of routes) {
      let distance = 0;
      let connected = false;
      ctx.beginPath();
      route.points.forEach((p, i) => {
        if (i)
          distance +=
            GlobalModel.angularDistance(route.points[i - 1], p) *
            GlobalModel.RADIUS;
        if (p.elevation === null) {
          connected = false;
          return;
        }
        if (connected) ctx.lineTo(x(distance), y(p.elevation));
        else ctx.moveTo(x(distance), y(p.elevation));
        connected = true;
      });
      ctx.strokeStyle = "#" + colors[route.id].toString(16);
      ctx.lineWidth = route.id === state.selected ? 2 : 1;
      ctx.stroke();
    }
    ctx.fillStyle = "#b8b3a2";
    ctx.fillText("0 km", 39, 130);
    ctx.textAlign = "right";
    ctx.fillText(Math.round(longest) + " km", width - 5, 130);
  }
  function setLayer() {
    const layer = $("planet-layer").value,
      ls = Number($("planet-season").value);
    clearGroup(stormGroup);
    const baseLayer = layer === "surface" || layer === "photo";
    globe.setBasemap(layer);
    overlay.visible = !baseLayer;
    const hazardLayer = ["hazards", ...MarsHazards.keys, "solar"].includes(
      layer,
    );
    const scenario = hazardLayer ? engine.getScenario(options()) : null;
    if (!baseLayer) {
      const canvas = document.createElement("canvas");
      canvas.width = 360;
      canvas.height = 180;
      const context = canvas.getContext("2d"),
        image = context.createImageData(360, 180);
      for (let row = 0; row < 180; row++)
        for (let col = 0; col < 360; col++) {
          if (hazardLayer) {
            const i = row * 360 + col;
            image.data.set(
              MarsHazards.rgba(
                scenario.hazardField,
                i,
                scenario.cells[i],
                layer,
              ),
              i * 4,
            );
            continue;
          }
          const sample = engine.sample(89.5 - row, col - 179.5, ls);
          const value = layer === "elevation" ? sample.elevation
            : layer === "radiation" ? sample.radiationRelative
            : layer === "dust" ? sample.dustNormalized
            : MarsWeather.globalAt(
              state.weather,
              89.5 - row,
              col - 179.5,
            ).dust;
          const i = (row * 360 + col) * 4;
          image.data.set(MarsLayerLegend.planetColor(layer, value), i);
        }
      context.putImageData(image, 0, 0);
      overlayMaterial.map?.dispose();
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      overlayMaterial.map = texture;
      overlayMaterial.needsUpdate = true;
    }
    const events = engine.getSeasonEvents(ls);
    if (layer === "dust") {
      const coordinates = events.flatMap((event) =>
        globe.positionAt(event.lat, event.lon, 0.005).toArray(),
      );
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(coordinates, 3),
      );
      stormGroup.add(
        new THREE.Points(
          geometry,
          new THREE.PointsMaterial({
            color: 0xffe8a7,
            size: 4,
            sizeAttenuation: false,
            depthWrite: false,
          }),
        ),
      );
    }
    const labels = {
      scenario: `SIMULATED · dust plume ${state.weather.lat.toFixed(1)}°, ${state.weather.lon.toFixed(1)}° · background ${state.weather.wind} m/s, ${state.weather.temperature} °C · seed ${state.weather.seed}`,
      surface:
        "HRSC + MOLA · 200 m source · detailed shaded-relief tiles on zoom · 3D mesh ×3",
      photo:
        "Colour surface overview · Solar System Scope · use HRSC relief for detailed terrain",
      elevation:
        "Elevation above areoid · blue −8 km → yellow/red +21 km · MOLA 0.5° data · 1° display mesh",
      dust: `${events.length} historical detections · MY26–30 · season Ls ${ls - 45}–${ls + 45}° · heat = counts within 5°. Sparse coverage ≠ low hazard.`,
      radiation:
        "Altitude-based comparison · hover over a location to see its relative index.",
    };
    MarsLayerLegend.planet($("global-legend"), layer,
      hazardLayer ? `Scenario seed ${state.hazards.seed}` : labels[layer], state.hazards.enabled);
    globe.markDirty();
  }
  $("planet-layer").onchange = setLayer;
  $("planet-season").onchange = () => {
    setLayer();
    window.dispatchEvent(new CustomEvent("mars-conditions-change"));
    if (state.result) calculate();
  };
  window.addEventListener("mars-pointer", (event) => {
    if (
      !event.detail ||
      ["surface", "photo"].includes($("planet-layer").value)
    ) {
      $("global-probe").hidden = true;
      return;
    }
    const point = event.detail,
      sample = engine.sample(
        point.lat,
        point.lon,
        Number($("planet-season").value),
      );
    $("global-probe").hidden = false;
    const w = engine.scenarioSample(point.lat, point.lon, options());
    if (
      ["hazards", ...MarsHazards.keys, "solar"].includes(
        $("planet-layer").value,
      )
    ) {
      $("global-probe").textContent =
        `${point.lat.toFixed(1)}°, ${point.lon.toFixed(1)}° · ${MarsHazards.description(engine.getScenario(options()).hazardField, w.index, w)} · ${w.temperature.toFixed(0)} °C`;
      return;
    }
    $("global-probe").textContent =
      $("planet-layer").value === "scenario"
        ? `${point.lat.toFixed(1)}°, ${point.lon.toFixed(1)}° · scenario ${w.temperature.toFixed(0)} °C · wind ${w.wind.toFixed(1)} m/s · visibility ${Math.round(w.visibility)} m`
        : `${point.lat.toFixed(1)}° N / ${point.lon.toFixed(1)}° E · elevation ${sample.elevation === null ? "unknown" : (sample.elevation / 1000).toFixed(1) + " km"} · ${sample.dustCount ?? "unknown"} nearby detections · radiation proxy ${sample.radiationRelative?.toFixed(2) ?? "unknown"}×`;
  });
  $("scene").addEventListener("pointerleave", () => {
    $("global-probe").hidden = true;
  });
  for (const name of ["pointerdown", "wheel"])
    $("scene").addEventListener(
      name,
      () => {
        if (state.following) {
          stopFollow();
          $("global-follow-status").textContent =
            "Route preview paused by map interaction.";
        }
      },
      { passive: true },
    );
  for (const id of ["globe-home", "globe-zoom-in", "globe-zoom-out"]) {
    $(id).addEventListener("click", () => {
      if (state.following) stopFollow();
    });
  }
  $("follow-global").onclick = () => {
    if (state.following) {
      stopFollow();
      return;
    }
    const route = state.result?.routes.find((r) => r.id === state.selected);
    if (!route || !route.distanceKm) return;
    stopFollow();
    state.following = true;
    $("follow-global").textContent = "Stop following";
    const points = densePoints(route.points),
      cumulative = [0];
    for (let i = 1; i < points.length; i++)
      cumulative.push(
        cumulative[i - 1] +
          GlobalModel.angularDistance(points[i - 1], points[i]) *
            GlobalModel.RADIUS,
      );
    const total = cumulative.at(-1),
      start = performance.now();
    const rover = new THREE.Mesh(
      new THREE.SphereGeometry(0.006, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    routesGroup.add(rover);
    state.followMarker = rover;
    function frame(now) {
      if (!state.following) {
        routesGroup.remove(rover);
        rover.geometry.dispose();
        rover.material.dispose();
        globe.markDirty();
        return;
      }
      const progress = Math.min(1, (now - start) / 20000);
      let i = 0;
      while (i < cumulative.length - 1 && cumulative[i] < progress * total) i++;
      const p = points[i];
      rover.position.copy(globe.positionAt(p.lat, p.lon, 0.008));
      globe.setView(p.lat, p.lon, 1.8);
      $("global-follow-status").textContent =
        `${progress === 1 ? "Destination reached" : "Following route"} · ${Math.round(progress * route.distanceKm).toLocaleString("en")} / ${Math.round(route.distanceKm).toLocaleString("en")} km · ${(progress * route.sols).toFixed(1)} scenario sols`;
      if (progress < 1) state.frame = requestAnimationFrame(frame);
      else {
        state.following = false;
        $("follow-global").textContent = "Follow selected route →";
      }
    }
    state.frame = requestAnimationFrame(frame);
  };
  $("export-global").onclick = () => {
    const route = state.result?.routes.find((r) => r.id === state.selected);
    if (!route) return;
    const payload = {
      title: "Mars global traverse",
      from: state.from,
      to: state.to,
      settings: options(),
      route,
      model: state.result.model,
      sources: {
        mola: window.MARS_GLOBAL.source,
        storms: catalogue.metadata.url,
        radiation:
          "https://science.nasa.gov/photojournal/estimated-radiation-dosage-on-mars/",
      },
      limitations: [
        "1 degree regional planning grid; no local traversability guarantee.",
        "Dust counts have uneven observation coverage and are not probabilities.",
        "Relative atmospheric-shielding proxy is not calibrated dose.",
        "One-way constant-season vehicle scenario excludes stops, supplies and rescue.",
      ],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "mars-global-route.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("global-data-content").innerHTML =
    `<h3>All named features</h3><p>${globe.regions.length.toLocaleString("en")} unique adopted IAU features from the USGS Gazetteer. The inherited catalogue was checked against the official GIS download on 15 November 2026; one duplicate Bohar entry was removed. All categories are enabled. Labels are placed by screen size and spacing; zoom to reveal smaller features, search in English or known Russian aliases, or click a landform. A single white boundary appears only after selection, with a pixel-edged radial reveal. Category filters control which names and points can be selected.</p><p>Area selection restores the earlier project's connected-region method: local HRSC/MOLA 200 m source for basins, highlands, ridges and troughs, image brightness for albedo markings. These derived display areas are approximate. Unresolved features are shown only as named locations, with no fabricated outline. Albedo names without a diameter use an assumed 750 km analysis window. Cards identify the method. The IAU catalogue supplies names, centres and dimensions, not official geological boundary polygons.</p><p><a href="https://planetarynames.wr.usgs.gov/GIS_Downloads" target="_blank" rel="noopener">IAU / USGS catalogue</a> · <a href="https://planetarynames.wr.usgs.gov/DescriptorTerms" target="_blank" rel="noopener">Landform type definitions</a> · <a href="https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m" target="_blank" rel="noopener">Fergason, Hare & Laura (2018), HRSC/MOLA</a></p><p>HRSC: ESA / DLR / FU Berlin, CC BY-SA 3.0 IGO; MOLA: NASA public data. HRSC-derived area geometries retain CC BY-SA 3.0 IGO attribution. Surface/albedo texture: <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener">Solar System Scope</a>, CC BY 4.0. Unexaggerated area elevations in the cards use the local HRSC/MOLA source. Contours are generated from the data and require independent validation; a unique physical boundary is not defined for every named land region.</p><h3>Global 3D surface</h3><p>Mars Global Surveyor MOLA MEGDR product MEGT90N000EB.IMG, acquired 1997–2001. The inherited 1/16° source is averaged to 0.5° for this globe. The 1° display mesh samples those elevations with ×3 vertical exaggeration. MOLA includes interpolated cells between observations. The global route grid is 1°, approximately 59 km north–south. Source pixel spacing and routing resolution differ.</p><p><a href="${window.MARS_GLOBAL.source}" target="_blank" rel="noopener">NASA PDS / MOLA archive</a></p><h3>Historical dust observations</h3><p>${catalogue.metadata.detectionCount} detections from the OMEGA/Mars Express Dust Storm Catalogue, MY26–30 (2004–2010). ${catalogue.metadata.credit}. CC BY 4.0. Selected seasons span 90° of solar longitude Ls. Each map cell counts detections within 5°; route cost divides that count by the selected season's maximum count. Dots show observed centroids. Heat halos describe the counting radius, not storm footprints.</p><p>The catalogue contains repeat detections and strongly uneven sampling across years and locations. Low or zero counts may reflect missing observations. These data support historical context, without establishing current weather, annual frequency or event probability. Seasonal indices are normalized independently and should not be compared as absolute activity between seasons.</p><p><a href="${catalogue.metadata.url}" target="_blank" rel="noopener">ODSC v2 dataset and attribution</a> · <a href="https://www.jpl.nasa.gov/news/nasa-mars-orbiters-reveal-seasonal-dust-storm-pattern/" target="_blank" rel="noopener">NASA seasonal storm context</a></p><h3>Radiation and atmospheric shielding</h3><p>NASA and RAD studies describe the influence of atmospheric depth on cosmic-radiation exposure. This prototype uses exp(h/10,800 m), an inverse-column proxy normalized to altitude zero. Higher values mean less atmospheric column in the assumed exponential atmosphere. The scale height and response are model assumptions. Radiation includes solar and galactic particles and secondary particles whose behavior is more complex than this proxy. No radiation dose or ground radioactivity measurement is inferred.</p><p><a href="https://science.nasa.gov/photojournal/estimated-radiation-dosage-on-mars/" target="_blank" rel="noopener">NASA elevation and radiation context</a> · <a href="https://arxiv.org/abs/1712.06987" target="_blank" rel="noopener">Guo et al. atmospheric shielding study</a></p><h3>Long-distance route comparison</h3><p>The baseline is the spherical shortest path. The alternative uses 8-neighbor A* on a 1° grid with longitude wrapping and polar connections. Each edge costs distance × scenario weather penalty × (1 + dust weight × normalized historical detection count + radiation weight × shielding proxy). Scenario dust follows a spherical Gaussian plume; temperature, wind and visibility alter driving time. Holds: wind ≥50 m/s, visibility below 100 m or temperature below −100 °C. All thresholds and response coefficients are prototype assumptions. Both candidates are evaluated with the same integral cost, and the lower-cost option is recommended. Routes lie on the displayed 3D terrain. Local slopes, cliffs, sand, ice and boulders are unresolved by this regional grid.</p><p>Travel sols = sum of weather-adjusted segment times / driving hours per sol. This is a one-way driving scenario with a fixed season, without supply budgets, overnight shielding, charging or rescue planning. The path follower is an accelerated presentation. Use the Valles Marineris planner for a small HiRISE terrain patch in Southwest Candor and local walking-route analysis.</p>`;
  $("global-data-content").insertAdjacentHTML(
    "afterbegin",
    `<h3>Detailed HRSC + MOLA relief</h3><p>The default map is shaded relief derived from the local 11.38 GB Mars HRSC/MOLA Blended DEM v2, 106,694 × 53,347 pixels, 200 m source spacing. The seven-level local tile pyramid retains approximately 200.37 m spacing at its finest level. Only the visible patch is loaded; the GPU detail texture is limited to 4096 pixels and the decoded-tile cache to 36 entries. This is elevation-derived shading, not orbital colour photography. The colour overview remains available separately.</p><p>Relief lighting is enhanced ×3.2 for readability; the lightweight 1° 3D mesh and global routing still use their existing MOLA grid. More detailed shading does not add unresolved cliffs to route geometry. Area terrain screening aggregates unexaggerated source slopes into 1° cells; polar slope statistics above 88° latitude are withheld. The region hazard index is a prototype screening score, not an accident probability. Directions identify the strongest sampled scenario cell, not a measured disaster epicentre.</p><p>Derived tiles: USGS Astrogeology / Fergason, Hare & Laura (2018); HRSC: ESA/DLR/FU Berlin, <a href="https://creativecommons.org/licenses/by-sa/3.0/igo/" target="_blank" rel="noopener">CC BY-SA 3.0 IGO</a>; MOLA: NASA public data. <a href="assets/global/hrsc/manifest.json" target="_blank">Local data manifest ↗</a> · <a href="${window.MARS_HRSC.source}" target="_blank" rel="noopener">Source DEM ↗</a></p>`,
  );
  $("global-data-content").insertAdjacentHTML(
    "afterbegin",
    `<h3>Catalogue review · 15 November 2026</h3><p>${globe.regions.filter((r) => r.area.polygons.length).length.toLocaleString("en")} approximate contours passed topology, spherical projection and extraction-edge checks. ${globe.regions.filter((r) => !r.area.polygons.length).length} boundaries are unresolved and withheld. These checks do not independently establish the physical landform boundaries.</p><p><a href="data/boundary-audit.json" target="_blank">Full boundary audit ↗</a></p><h3>Wikipedia cards</h3><p>Saved English Wikipedia articles are matched by name and Mars identity, using coordinates when available. Crater-table entries and additional Wikimedia images are linked by exact IAU feature identifiers. ${window.MARS_WIKIPEDIA?.meta.articles ?? 0} article / list references and ${window.MARS_WIKIPEDIA?.meta.images ?? 0} images are included locally. Missing articles/images are stated explicitly. Text excerpts credit Wikipedia contributors under CC BY-SA 4.0; each image retains its own source, author and license.</p><p><a href="data/wikipedia-sources.json" target="_blank">Article revisions, image attribution and import sources ↗</a></p>`,
  );
  $("global-data-content").insertAdjacentHTML(
    "beforeend",
    MarsHazards.evidenceHtml(),
  );
  $("global-data-open").onclick = () => $("global-data").showModal();
  $("global-data-close").onclick = () => $("global-data").close();
  window.addEventListener("resize", () => {
    if (state.result) drawProfile();
  });
  function renderComparison() {
    const saved = state.saved,
      box = $("global-comparison");
    if (!saved) {
      box.textContent =
        "Save a baseline, then change weather to compare the same trip.";
      return;
    }
    if (JSON.stringify([state.from, state.to]) !== saved.trip) {
      box.textContent =
        "Saved scenario belongs to a different departure/destination. Save this trip to compare.";
      return;
    }
    const now = state.result?.routes.find((r) => r.id === state.selected);
    if (!now) return;
    const signed = (v) => (v >= 0 ? "+" : "") + v.toFixed(1);
    box.textContent = `Against saved weather ${saved.weather.seed} / hazard seed ${saved.hazards?.seed}: ${signed(now.distanceKm - saved.route.distanceKm)} km · ${signed(now.sols - saved.route.sols)} sols · peak wind ${signed(now.maxWind - saved.route.maxWind)} m/s. Saved: ${saved.weather.temperature} °C, ${saved.weather.wind} m/s; now: ${state.weather.temperature} °C, ${state.weather.wind} m/s.`;
  }
  $("save-global-scenario").onclick = () => {
    const route = state.result?.routes.find((r) => r.id === state.selected);
    if (!route) return;
    state.saved = {
      route: JSON.parse(JSON.stringify(route)),
      weather: { ...state.weather },
      hazards: JSON.parse(JSON.stringify(state.hazards)),
      trip: JSON.stringify([state.from, state.to]),
    };
    renderComparison();
  };
  window.addEventListener("mars-weather", (event) => {
    state.weather = MarsWeather.save(event.detail);
    setLayer();
    window.dispatchEvent(new CustomEvent("mars-conditions-change"));
    if (state.result) calculate();
  });
  document.addEventListener("click", (event) => {
    const a = event.target.closest('a[href^="valles.html"]');
    if (a)
      a.href =
        "valles.html?weather=" +
        encodeURIComponent(JSON.stringify(state.weather)) +
        "&hazards=" +
        encodeURIComponent(JSON.stringify(state.hazards));
  });
  function setHazards(config) {
    state.hazards = MarsHazards.save(config);
    $("planet-layer").value = "hazards";
    setLayer();
    window.dispatchEvent(new CustomEvent("mars-conditions-change"));
    if (state.result) calculate();
  }
  MarsHazardUI.mount({
    button: "hazards-open",
    scope: "global",
    read: () => state.hazards,
    apply: setHazards,
    locate: () => {
      const route = state.result?.routes.find((r) => r.id === "short");
      return route?.points[Math.floor(route.points.length / 2)] || state.to;
    },
  });
  window.__globalPlanner = {
    state,
    calculate,
    setLayer,
    chooseOnGlobe,
    options,
    setHazards,
  };
  setLayer();
})();
