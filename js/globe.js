"use strict";
// Global Mars terrain viewer, region/mission selection and long-distance route surface.
(function () {
  const { THREE, TrackballControls } = window;
  const MISSIONS = window.MISSIONS,
    ZONES = window.ZONES;
  const DEG = Math.PI / 180;
  const $ = (id) => document.getElementById(id);

  const START_DIST = 3.4;
  const MARS_RADIUS_KM = 3396.19;
  const MIN_ALTITUDE_KM = 500;
  const terrainData = window.MARS_GLOBAL;
  const engine = window.GlobalModel.create(
    terrainData,
    window.MARS_STORMS.events,
  );
  const RELIEF_SCALE = 3;
  let flight = null;
  let surfacePicker = null;
  function elevationAt(lat, lon) {
    const column = Math.floor(
      (((((lon + 180) % 360) + 360) % 360) / 360) * terrainData.width,
    );
    const row = Math.min(
      terrainData.height - 1,
      Math.max(0, Math.floor(((90 - lat) / 180) * terrainData.height)),
    );
    return terrainData.heights[row * terrainData.width + column];
  }
  function positionAt(lat, lon, lift = 0.002) {
    return latLonToVec(
      lat,
      lon,
      1 + (elevationAt(lat, lon) / 3396190) * RELIEF_SCALE + lift,
    );
  }
  function environmentText(point) {
    const sample = engine.sample(
      point.lat,
      point.lon,
      Number($("planet-season").value),
    );
    return `${sample.dustCount} historical dust detections within 5° of this point in the selected season. Relative radiation proxy ${sample.radiationRelative.toFixed(2)}× at the centre. Observation coverage is uneven; proxy is uncalibrated.`;
  }
  const AUTO_ROTATE_RAD_S = 0.04;
  const IDLE_RESUME_MS = 9000;
  const NORMAL_SCALE = 0.6; // the normal map is baked with ×10 relief
  const SITE_COLOR = new THREE.Color("#ff7a4c");
  const PLAY_COLOR = new THREE.Color("#4fe3ff");

  // Matches SphereGeometry UVs with an equirectangular map spanning lon −180…180.
  function latLonToVec(lat, lon, r = 1, out = new THREE.Vector3()) {
    const la = lat * DEG,
      phi = (lon + 180) * DEG;
    return out
      .set(
        -Math.cos(phi) * Math.cos(la),
        Math.sin(la),
        Math.sin(phi) * Math.cos(la),
      )
      .multiplyScalar(r);
  }
  const fmtLat = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "N" : "S"}`;
  const fmtLon = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "E" : "W"}`;

  /* ---------- renderer / scene ---------- */
  const canvas = $("scene");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.01, 300);
  scene.add(camera);

  // Hard key light tied to the camera and a near-black cool ambient: relief reads through shadows.
  const sun = new THREE.DirectionalLight(0xfff4ea, 4.6);
  sun.position.set(-1.3, 2.2, 1.7);
  camera.add(sun);
  scene.add(new THREE.AmbientLight(0x2a3340, 0.35));

  const controls = new TrackballControls(camera, canvas);
  controls.noPan = true;
  controls.noZoom = false;
  controls.rotateSpeed = 2.2;
  controls.zoomSpeed = 1.0;
  controls.dynamicDampingFactor = 0.2;
  controls.minDistance = 1 + MIN_ALTITUDE_KM / MARS_RADIUS_KM;
  controls.maxDistance = 5.5;

  function resize() {
    const w = innerWidth,
      h = innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    const fit = Math.min(1, camera.aspect / 0.83);
    camera.fov = (2 * Math.atan(Math.tan(23 * DEG) / fit)) / DEG;
    camera.updateProjectionMatrix();
    controls.handleResize();
    dirty = true;
  }

  /* ---------- stars ---------- */
  function dotTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.35, "rgba(255,255,255,.55)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  const dot = dotTexture();
  function makeStars(count, size, opacity) {
    const pos = new Float32Array(count * 3),
      col = new Float32Array(count * 3);
    const v = new THREE.Vector3(),
      c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      v.randomDirection().multiplyScalar(120 + Math.random() * 60);
      pos.set([v.x, v.y, v.z], i * 3);
      c.setHSL(
        Math.random() < 0.2 ? 0.08 : 0.6,
        0.35,
        0.72 + Math.random() * 0.28,
      );
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size,
        map: dot,
        vertexColors: true,
        transparent: true,
        opacity,
        depthWrite: false,
        sizeAttenuation: false,
        blending: THREE.AdditiveBlending,
      }),
    );
  }
  scene.add(makeStars(1800, 1.5, 0.75), makeStars(200, 3, 0.9));

  // Faint Milky Way band: a tilted ring of dense dim stars.
  (function milkyWay() {
    const count = 2400,
      pos = new Float32Array(count * 3),
      col = new Float32Array(count * 3);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(1.1, 0.3, 0.5),
    );
    const v = new THREE.Vector3(),
      c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spread =
        (Math.random() + Math.random() + Math.random() - 1.5) * 0.18;
      v.set(Math.cos(a), spread, Math.sin(a))
        .normalize()
        .applyQuaternion(q)
        .multiplyScalar(150);
      pos.set([v.x, v.y, v.z], i * 3);
      c.setHSL(0.6 + Math.random() * 0.1, 0.3, 0.55 + Math.random() * 0.3);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    scene.add(
      new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          size: 1.2,
          map: dot,
          vertexColors: true,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
          sizeAttenuation: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
  })();

  /* ---------- planet ---------- */
  const planet = new THREE.Group();
  scene.add(planet);
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (src) =>
    new Promise((ok, fail) => {
      const t = loader.load(src, () => ok(t), undefined, fail);
      t.anisotropy = aniso;
    });
  const marsMat = new THREE.MeshStandardMaterial({
    color: 0x3a2018,
    roughness: 0.92,
    metalness: 0,
  });
  const terrainGeometry = new THREE.SphereGeometry(1, 360, 180);
  const terrainPositions = terrainGeometry.attributes.position;
  const terrainVertex = new THREE.Vector3();
  for (let i = 0; i < terrainPositions.count; i++) {
    terrainVertex.fromBufferAttribute(terrainPositions, i).normalize();
    const lat = Math.asin(Math.max(-1, Math.min(1, terrainVertex.y))) / DEG;
    const lon = Math.atan2(-terrainVertex.z, terrainVertex.x) / DEG;
    terrainVertex.multiplyScalar(
      1 + (elevationAt(lat, lon) / 3396190) * RELIEF_SCALE,
    );
    terrainPositions.setXYZ(
      i,
      terrainVertex.x,
      terrainVertex.y,
      terrainVertex.z,
    );
  }
  terrainGeometry.computeVertexNormals();
  const terrainMesh = new THREE.Mesh(terrainGeometry, marsMat);
  planet.add(terrainMesh);
  const reliefMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const terrainTiles = window.MarsTerrainTiles.create({
    THREE,
    camera,
    renderer,
    material: reliefMaterial,
    markDirty: () => {
      dirty = true;
    },
  });
  let basemap = "surface";
  function setBasemap(kind) {
    basemap = kind === "photo" ? "photo" : "surface";
    terrainMesh.material = basemap === "photo" ? marsMat : reliefMaterial;
    terrainTiles.setEnabled(basemap !== "photo");
    dirty = true;
  }
  const texReady = Promise.all([
    load(window.MARS_TEXTURE),
    load(window.MARS_NORMAL),
    load(window.MARS_HRSC_BASE),
  ]).then(([map, nrm, relief]) => {
    map.colorSpace = THREE.SRGBColorSpace;
    marsMat.map = map;
    marsMat.normalMap = nrm;
    marsMat.normalScale.set(NORMAL_SCALE, NORMAL_SCALE);
    marsMat.color.set(0xffffff);
    marsMat.needsUpdate = true;
    relief.colorSpace = THREE.SRGBColorSpace;
    reliefMaterial.map = relief;
    reliefMaterial.needsUpdate = true;
    setBasemap(basemap);
    dirty = true;
  });

  const fresnelVert = `
    varying vec3 vN; varying vec3 vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`;
  planet.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(1.07, 96, 48),
      new THREE.ShaderMaterial({
        vertexShader: fresnelVert,
        fragmentShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        float rim = 1.0 - abs(dot(vN, vV));
        float a = pow(clamp((1.0 - rim) / 0.36, 0.0, 1.0), 2.2) * 0.85;
        gl_FragColor = vec4(vec3(1.0, 0.52, 0.32) * a * 1.1, a);
      }`,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );
  planet.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(1.003, 96, 48),
      new THREE.ShaderMaterial({
        vertexShader: fresnelVert,
        fragmentShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
        gl_FragColor = vec4(vec3(1.0, 0.6, 0.42) * f * 0.75, f);
      }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );

  /* ---------- landing sites ---------- */
  const labelsRoot = $("labels");
  const hitTargets = [];
  for (const m of MISSIONS) {
    const n = latLonToVec(m.lat, m.lon);
    const g = new THREE.Group();
    g.position.copy(positionAt(m.lat, m.lon));
    g.lookAt(n.clone().multiplyScalar(2));
    const color = m.zones ? PLAY_COLOR : SITE_COLOR;
    const diamond = new THREE.Mesh(
      new THREE.CircleGeometry(0.008, 4),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        depthWrite: false,
      }),
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.014, 0.0162, 4),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    const hit = new THREE.Mesh(
      new THREE.CircleGeometry(0.035, 12),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.userData.mission = m;
    hitTargets.push(hit);
    g.add(diamond, ring, hit);
    planet.add(g);
    const label = document.createElement("div");
    label.className = "lbl" + (m.zones ? " play" : "");
    label.innerHTML = `<b>${m.name}</b><span>${m.year}</span>`;
    labelsRoot.appendChild(label);
    m._ui = { group: g, ring, diamond, normal: n, label };
  }

  /* ---------- full IAU catalogue, scale-aware labels and terrain areas ---------- */
  const regions = window.MARS_REGIONS;
  const GROUPS = {
    mons: { name: "Mountains", color: "#f3f3f0" },
    crater: { name: "Craters", color: "#f3f3f0" },
    low: { name: "Plains / lowlands", color: "#f3f3f0" },
    plat: { name: "Plateaus", color: "#f3f3f0" },
    valley: { name: "Valleys", color: "#f3f3f0" },
    mare: { name: "Albedo", color: "#f3f3f0" },
    other: { name: "Other terrain", color: "#f3f3f0" },
  };
  const enabledGroups = new Set(Object.keys(GROUPS));
  const sortedRegions = [...regions].sort(
    (a, b) => (b.diameter || 750) - (a.diameter || 750),
  );
  // Screen names are a separate, automatic hierarchy. Unknown diameters do
  // not inherit the old 750 km analysis window as if it were a measured size.
  const LABEL_LEVELS = [
    {
      name: "Planet",
      minAltitude: 6500,
      minSize: 1000,
      font: 12,
      range: "1,000 km+",
    },
    {
      name: "Regions",
      minAltitude: 3000,
      minSize: 300,
      font: 11,
      range: "300 km+",
    },
    {
      name: "Landforms",
      minAltitude: 1500,
      minSize: 100,
      font: 11,
      range: "100 km+",
    },
    {
      name: "Terrain",
      minAltitude: 800,
      minSize: 30,
      font: 10,
      range: "30 km+",
    },
    {
      name: "Local",
      minAltitude: 0,
      minSize: 0,
      font: 10,
      range: "small & unmeasured features",
    },
  ];
  const labelTier = new Map(
    regions.map((r) => [
      r.id,
      r.diameter > 0
        ? LABEL_LEVELS.findIndex((level) => r.diameter >= level.minSize)
        : 4,
    ]),
  );
  const labelGroups = LABEL_LEVELS.map((_, tier) =>
    regions
      .filter((r) => labelTier.get(r.id) === tier)
      .sort((a, b) => (b.diameter || 0) - (a.diameter || 0)),
  );
  const labelOrders = LABEL_LEVELS.map((_, level) =>
    labelGroups
      .slice(0, level + 1)
      .reverse()
      .flat(),
  );
  let activeLabelLevel = 0;
  const labelNodes = new Map();
  let placedLabels = [];
  const regionButtons = new Map();
  let mapMode = "regions";
  let selectedRegion = null;
  const groupPoints = new Map();
  const descriptions = {
    Jezero:
      "An ancient river delta preserves layered sedimentary rocks. Perseverance explores this record of water and past environments. The detailed planner now covers Southwest Candor in Valles Marineris.",
    Gale: "Curiosity explores the layered deposits of Mount Sharp. The Gale rover mission visits local terrain around Boxwork Ridges and Gediz Vallis.",
    "Olympus Mons":
      "A vast shield volcano in the Tharsis region. Its broad volcanic edifice stands high above the surrounding plains.",
    "Valles Marineris":
      "A system of deep troughs and connected canyons extending across the equatorial highlands.",
    "Hellas Planitia":
      "A deep, broad plain within the Hellas impact basin in the southern hemisphere.",
    "Utopia Planitia":
      "A northern lowland plain containing the Viking 2 and Zhurong landing regions.",
    "Elysium Planitia":
      "A broad plain south of the Elysium volcanic region and the landing region of InSight.",
    Gusev:
      "The crater where Spirit explored the Columbia Hills and silica-rich material near Home Plate.",
  };
  const typeDescriptions = {
    Crater: "A circular depression.",
    Mons: "A mountain or mountain range.",
    Tholus: "A small domed mountain.",
    Patera: "An irregular or scalloped depression.",
    Collis: "Small hills.",
    Planitia: "A low plain.",
    Vastitas: "An extensive plain.",
    Chaos: "Broken, disrupted terrain.",
    Cavus: "An irregular hollow.",
    Palus: "A small plain.",
    Planum: "A plateau or high plain.",
    Terra: "An extensive land region.",
    Mensa: "A flat-topped prominence with steep margins.",
    Lingula: "A lobed extension of a plateau.",
    Vallis: "A valley.",
    Chasma: "A deep, elongated depression with steep sides.",
    Labyrinthus: "Intersecting valleys or ridges.",
    Fossa: "A long, narrow depression.",
    Catena: "A chain of craters.",
    Sulcus: "Subparallel furrows and ridges.",
    "Albedo Feature":
      "An area distinguished by its reflectivity. Classical Martian “seas” are albedo markings.",
    Macula: "A dark marking.",
    Dorsum: "A ridge.",
    Rupes: "A scarp.",
    Scopulus: "An irregular scarp.",
    Labes: "Landslide terrain.",
    Unda: "A dune field.",
    Serpens: "A sinuous raised feature.",
    Fluctus: "Flow terrain.",
  };
  for (const r of regions) {
    r._normal = latLonToVec(r.lat, r.lon);
    r._north = new THREE.Vector3(0, 1, 0)
      .addScaledVector(r._normal, -r._normal.y)
      .normalize();
    if (r._north.lengthSq() < 0.1) r._north.set(0, 0, 1);
    r._east = new THREE.Vector3().crossVectors(r._north, r._normal).normalize();
    r._position = positionAt(r.lat, r.lon, 0.0018);
  }
  for (const [key, group] of Object.entries(GROUPS)) {
    const items = regions.filter((r) => r.group === key);
    const geo = new THREE.BufferGeometry().setFromPoints(
      items.map((r) => r._position),
    );
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: group.color,
        size: 2.5,
        map: dot,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        sizeAttenuation: false,
      }),
    );
    planet.add(points);
    groupPoints.set(key, points);
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.value = key;
    label.style.setProperty("--group-color", group.color);
    const text = document.createElement("span");
    text.textContent = group.name;
    const count = document.createElement("small");
    count.textContent = items.length;
    label.append(checkbox, text, count);
    $("region-filters").append(label);
    checkbox.addEventListener("change", () => {
      checkbox.checked ? enabledGroups.add(key) : enabledGroups.delete(key);
      if (selectedRegion && !enabledGroups.has(selectedRegion.group))
        closeRegion();
      renderRegionList();
      dirty = true;
    });
  }
  const selectionLayer = window.MarsRegionSelection.create({
    THREE,
    planet,
    terrainGeometry,
    maxTextureSize: renderer.capabilities.maxTextureSize,
  });
  const areaMesh = selectionLayer.mesh;
  const regionCapture = window.MarsRegionCapture.create({
    THREE,
    camera,
    positionAt,
    minDistance: controls.minDistance,
  });
  function highlightArea(r) {
    selectionLayer.select(r);
    dirty = true;
  }
  function regionContains(r, n) {
    const a = r.area;
    if (!a.polygons.length) return false;
    if (n.dot(r._normal) < Math.sqrt(Math.max(0, 1 - 2 * a.s * a.s)))
      return false;
    const x = ((n.dot(r._east) / a.s) * 0.5 + 0.5) * a.n,
      y = ((n.dot(r._north) / a.s) * 0.5 + 0.5) * a.n;
    if (x < 0 || x > a.n || y < 0 || y > a.n) return false;
    let inside = false;
    for (const polygon of a.polygons)
      for (const p of polygon)
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          if (
            p[i][1] > y !== p[j][1] > y &&
            x <
              ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) +
                p[i][0]
          )
            inside = !inside;
        }
    return inside;
  }
  let listSignature = null,
    lastListSelection = null;
  function renderRegionList() {
    const signature =
      $("region-search").value + "/" + [...enabledGroups].join(",");
    if (signature === listSignature) {
      if (lastListSelection !== selectedRegion) {
        regionButtons
          .get(lastListSelection?.id)
          ?.setAttribute("aria-pressed", "false");
        regionButtons
          .get(selectedRegion?.id)
          ?.setAttribute("aria-pressed", "true");
        lastListSelection = selectedRegion;
      }
      return;
    }
    listSignature = signature;
    lastListSelection = selectedRegion;
    const query = $("region-search").value.trim().toLocaleLowerCase();
    const matches = sortedRegions.filter(
      (r) =>
        enabledGroups.has(r.group) &&
        (!query ||
          `${r.name} ${r.alias || ""}`.toLocaleLowerCase().includes(query)),
    );
    $("region-count").textContent =
      `${matches.length.toLocaleString("en")} of ${regions.length.toLocaleString("en")} named features`;
    $("region-total").textContent =
      `${regions.length.toLocaleString("en")} OBJECTS · FULL CATALOGUE`;
    $("region-page").textContent = "Scroll the full catalogue ↓";
    $("region-list").style.height =
      matches.length < 6 ? Math.max(55, matches.length * 44) + "px" : "";
    $("region-list").replaceChildren();
    for (const r of matches) {
      let button = regionButtons.get(r.id);
      if (button) {
        button.setAttribute("aria-pressed", String(selectedRegion === r));
        $("region-list").append(button);
        continue;
      }
      button = document.createElement("button");
      regionButtons.set(r.id, button);
      button.className = "region-option";
      button.dataset.region = r.id;
      button.setAttribute("aria-pressed", String(selectedRegion === r));
      const name = document.createElement("span");
      name.textContent = r.name;
      const type = document.createElement("small");
      type.textContent = ["Valles Marineris", "Candor Chasma"].includes(r.name)
        ? "DETAILED MAP"
        : r.type.split(",")[0];
      button.append(name, type);
      button.onclick = () => selectRegion(r);
      $("region-list").append(button);
    }
    if (!matches.length)
      $("region-list").textContent = "No matching names in the enabled groups.";
  }
  function closeRegion() {
    if (flight?.regionCapture) flight = null;
    regionCapture.clear();
    selectedRegion = null;
    window.MarsRegionRisk?.clear();
    highlightArea(null);
    $("region-card").hidden = true;
    document.body.classList.remove("region-selected");
    renderRegionList();
    dirty = true;
  }
  function setMapMode(mode) {
    mapMode = mode;
    hovered = null;
    canvas.classList.remove("pointing");
    closeCard();
    closeRegion();
    for (const key of ["regions", "missions", "routes"])
      $("mode-" + key).setAttribute("aria-pressed", String(mode === key));
    $("region-controls").hidden = mode !== "regions";
    $("mission-controls").hidden = mode !== "missions";
    $("global-route-controls").hidden = mode !== "routes";
    document.body.classList.toggle("global-routing", mode === "routes");
    window.dispatchEvent(new CustomEvent("mars-mode", { detail: mode }));
    $("hint").textContent =
      mode === "regions"
        ? "Drag to rotate · Scroll for smaller names · Click a landform"
        : mode === "routes"
          ? "Pick departure and destination · Scroll to zoom"
          : "Drag to rotate · Click an expedition site";
    dirty = true;
  }
  function selectRegion(r) {
    if (mapMode !== "regions") setMapMode("regions");
    closeCard();
    selectedRegion = r;
    if (!enabledGroups.has(r.group)) {
      enabledGroups.add(r.group);
      $("region-filters").querySelector(`[value="${r.group}"]`).checked = true;
    }
    $("region-type").textContent = r.type.split(",")[0] + " · IAU / USGS";
    $("region-name").textContent = r.name;
    $("region-coordinates").textContent =
      `${fmtLat(r.lat)} ${fmtLon(r.lon)}${r.diameter ? " · " + r.diameter.toLocaleString("en", { maximumFractionDigits: 2 }) + " km across" : ""}`;
    const fallbackDescription =
      descriptions[r.name] ||
      typeDescriptions[r.type.split(",")[0]] ||
      "A named surface feature in the IAU catalogue.";
    window.MarsWikipedia.render(r, fallbackDescription);
    window.MarsRegionRisk?.render(r, fallbackDescription);
    $("region-origin").textContent =
      `Name origin · ${r.origin} Adopted ${r.year}.`;
    $("region-source").href = r.source;
    $("region-environment").textContent = environmentText(r);
    const a = r.area,
      format = (n) =>
        n === null ? "Unresolved" : (n / 1000).toFixed(2) + " km";
    $("region-quality").dataset.status = a.polygons.length
      ? "approximate"
      : "unresolved";
    $("region-quality").textContent = a.polygons.length
      ? "Approximate contour · geometry and map projection checked. The physical boundary is not independently verified."
      : "Boundary withheld · " +
        (a.reason ||
          "The available data cannot resolve this landform reliably.");
    $("region-stats").replaceChildren();
    for (const [key, value] of [
      ["Elevation at centre", format(a.center)],
      ["Area elevation range", `${format(a.min)} … ${format(a.max)}`],
      [
        "Highlighted area",
        a.km2 === null
          ? "Boundary unresolved"
          : "≈ " + Math.round(a.km2).toLocaleString("en") + " km²",
      ],
    ]) {
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = value;
      $("region-stats").append(dt, dd);
    }
    $("region-boundary").textContent =
      a.method === "linear"
        ? "Terrain-derived ridges / troughs · HRSC + MOLA 200 m source, sampled for display. Approximate morphology, not an IAU boundary."
        : a.method === "terrain"
          ? "Terrain-derived area · HRSC + MOLA 200 m source. The contour follows sampled relief; independent boundary validation is still needed."
          : a.method === "albedo"
            ? "Image-derived albedo area · Solar System Scope texture. No catalogue diameter; a 750 km search window is assumed."
            : "Boundary unresolved at the available resolution. Only the named location is shown; the catalogue supplies no verified boundary polygon.";
    const detailed = ["Valles Marineris", "Candor Chasma"].includes(r.name);
    $("region-open").hidden = !detailed;
    $("region-coverage").replaceChildren();
    if (detailed) {
      const image = document.createElement("img");
      image.src = "assets/valles/surface.jpg";
      image.alt = "HiRISE Southwest Candor study patch";
      const title = document.createElement("strong");
      title.textContent = "Southwest Candor · local terrain patch";
      const p = document.createElement("p");
      p.textContent =
        "HiRISE imagery 25 cm/px · elevation source 1 m · route grid 5 m.";
      $("region-coverage").append(image, title, p);
    } else
      $("region-coverage").textContent =
        r.name === "Gale"
          ? "Gale rover mission is available below. Detailed walking routes are available in Valles Marineris."
          : "Global region overview. The detailed walking planner covers Southwest Candor in Valles Marineris.";
    $("region-card").hidden = false;
    $("region-card").scrollTop = 0;
    document.body.classList.add("region-selected");
    highlightArea(r);
    const framing = regionCapture.select(r);
    focusLocation(framing.lat, framing.lon, framing.distance, true);
    if (regionCapture.reducedMotion) flight.start -= 900;
    stopAuto();
    renderRegionList();
    dirty = true;
  }
  function updateRegionLabels() {
    for (const [key, points] of groupPoints)
      points.visible =
        mapMode === "regions" && !zonesOpen && enabledGroups.has(key);
    placedLabels = [];
    const shown = new Set();
    const browserRect = $("region-browser-shell").getBoundingClientRect();
    const browserVisible =
      getComputedStyle($("region-browser-shell")).display !== "none";
    const cardRect = $("region-card").getBoundingClientRect();
    const altitude = (camera.position.length() - 1) * MARS_RADIUS_KM;
    // A 6% dead band prevents repeated layer switching near a zoom threshold.
    while (
      activeLabelLevel < LABEL_LEVELS.length - 1 &&
      altitude < LABEL_LEVELS[activeLabelLevel].minAltitude * 0.94
    )
      activeLabelLevel++;
    while (
      activeLabelLevel > 0 &&
      altitude > LABEL_LEVELS[activeLabelLevel - 1].minAltitude * 1.06
    )
      activeLabelLevel--;
    const level = LABEL_LEVELS[activeLabelLevel];
    const scaleText = `Names · ${level.name} · ${level.range}`;
    if ($("label-scale-status").textContent !== scaleText)
      $("label-scale-status").textContent = scaleText;
    $("label-scale-status").dataset.level = String(activeLabelLevel);
    if (mapMode === "regions" && !zonesOpen) {
      const order = selectedRegion
        ? [selectedRegion, ...labelOrders[activeLabelLevel]]
        : labelOrders[activeLabelLevel];
      const pxPerUnit = innerHeight / 2 / Math.tan((camera.fov * DEG) / 2);
      for (const r of order) {
        if (shown.has(r.id) || !enabledGroups.has(r.group)) continue;
        const toCamera = camera.position.clone().sub(r._position),
          distance = toCamera.length();
        if (r._normal.dot(toCamera) / distance < 0.18) continue;
        const tier = labelTier.get(r.id);
        const screenSize =
          (((r.diameter || 0) / MARS_RADIUS_KM) * pxPerUnit) / distance;
        if (r !== selectedRegion) {
          if (activeLabelLevel < 4 && screenSize < 8) continue;
          // Keep useful parent names, but stop continent-scale captions from
          // competing with small objects when their footprint fills the view.
          if (
            tier < activeLabelLevel &&
            screenSize > Math.min(innerWidth, innerHeight) * 0.7
          )
            continue;
        }
        const p = r._position.clone().project(camera),
          x = (p.x * 0.5 + 0.5) * innerWidth,
          y = (-p.y * 0.5 + 0.5) * innerHeight;
        if (x < 5 || x > innerWidth - 5 || y < 130 || y > innerHeight - 60)
          continue;
        // Keep map labels clear of fixed exploration controls and detail cards.
        if (
          browserVisible &&
          x > browserRect.left - 40 &&
          x < browserRect.right + 70 &&
          y > browserRect.top - 15 &&
          y < browserRect.bottom + 15
        )
          continue;
        if (
          !$("region-card").hidden &&
          x > cardRect.left - 50 &&
          x < cardRect.right &&
          y > cardRect.top &&
          y < cardRect.bottom
        )
          continue;
        const fontSize =
          r === selectedRegion
            ? 12
            : Math.max(
                9,
                LABEL_LEVELS[tier].font - (innerWidth <= 700 ? 1 : 0),
              );
        const width = Math.min(260, r.name.length * fontSize * 0.67 + 16),
          box = {
            r,
            x0: x - width / 2 - 5,
            x1: x + width / 2 + 5,
            y0: y - 12,
            y1: y + 12,
          };
        if (box.x0 < 6 || box.x1 > innerWidth - 6) continue;
        if (
          placedLabels.some(
            (b) =>
              box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0,
          )
        )
          continue;
        let el = labelNodes.get(r.id);
        if (!el) {
          el = document.createElement("div");
          el.className = "lbl region-label";
          el.textContent = r.name;
          el.style.color = GROUPS[r.group].color;
          labelsRoot.append(el);
          labelNodes.set(r.id, el);
        }
        el.style.display = "flex";
        el.style.opacity =
          r === selectedRegion || tier === activeLabelLevel ? "1" : ".65";
        el.style.fontSize = fontSize + "px";
        el.dataset.nameTier = String(tier);
        el.dataset.regionId = r.id;
        el.style.transform = `translate(${x - width / 2}px,${y - 8}px)`;
        el.style.width = width + "px";
        el.classList.toggle("hot", r === selectedRegion || r === hovered);
        shown.add(r.id);
        placedLabels.push(box);
        if (placedLabels.length >= (innerWidth <= 700 ? 22 : 40)) break;
      }
    }
    for (const [id, el] of labelNodes)
      if (!shown.has(id)) el.style.display = "none";
    $("map-name-count").textContent =
      `ATLAS 11 · ${regions.length.toLocaleString("en")} objects · ${level.name} names`;
  }
  $("region-search").addEventListener("input", () => {
    renderRegionList();
  });
  $("region-close").onclick = closeRegion;
  for (const mode of ["regions", "missions", "routes"])
    $("mode-" + mode).onclick = () => setMapMode(mode);
  for (const mission of MISSIONS) {
    const option = document.createElement("option");
    option.value = mission.id;
    option.textContent = mission.name + " · " + mission.site;
    $("mission-select").append(option);
  }
  $("mission-select").onchange = () => {
    const m = MISSIONS.find((m) => m.id === $("mission-select").value);
    if (m) select(m);
  };
  $("find-valles").onclick = () =>
    selectRegion(regions.find((r) => r.name === "Valles Marineris"));
  renderRegionList();

  /* ---------- picking ---------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = null,
    selected = null,
    downAt = null;
  const pickingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  function pickSurface(e) {
    ndc.set(
      (e.clientX / innerWidth) * 2 - 1,
      -(e.clientY / innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const point = raycaster.ray.intersectSphere(
      pickingSphere,
      new THREE.Vector3(),
    );
    if (!point) return null;
    // Global relief is a small radial displacement. Two sphere refinements give
    // a surface coordinate without traversing every triangle in the 3D mesh.
    for (let i = 0; i < 2; i++) {
      const n = point.clone().normalize();
      const lat = Math.asin(n.y) / DEG,
        lon = Math.atan2(-n.z, n.x) / DEG;
      const radius = 1 + (elevationAt(lat, lon) / 3396190) * RELIEF_SCALE;
      const refined = raycaster.ray.intersectSphere(
        new THREE.Sphere(pickingSphere.center, radius),
        new THREE.Vector3(),
      );
      if (refined) point.copy(refined);
    }
    if (!point) return null;
    point.normalize();
    return {
      lat: Math.asin(point.y) / DEG,
      lon: Math.atan2(-point.z, point.x) / DEG,
    };
  }
  function stopControlMomentum() {
    // Bundled TrackballControls r169 retains drag/zoom momentum across a
    // programmatic flight. Its public reset() does not clear these accumulators.
    controls._lastAngle = 0;
    controls._movePrev.copy(controls._moveCurr);
    controls._zoomStart.copy(controls._zoomEnd);
    controls._panStart.copy(controls._panEnd);
  }
  function clampCameraDistance(distance) {
    return Math.max(
      controls.minDistance,
      Math.min(controls.maxDistance, distance),
    );
  }
  function focusLocation(lat, lon, distance = 1.7, captureRegion = false) {
    stopControlMomentum();
    if (!captureRegion) regionCapture.cancel();
    stopAuto();
    const direction = camera.position.clone().normalize();
    const target = latLonToVec(Math.max(-89.99, Math.min(89.99, lat)), lon);
    flight = {
      start: performance.now(),
      direction,
      rotation: new THREE.Quaternion().setFromUnitVectors(direction, target),
      from: camera.position.length(),
      to: clampCameraDistance(distance),
      regionCapture: captureRegion,
    };
  }
  function setView(lat, lon, distance = 1.8) {
    stopControlMomentum();
    regionCapture.cancel();
    flight = null;
    stopAuto();
    camera.position.copy(latLonToVec(lat, lon, clampCameraDistance(distance)));
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    dirty = true;
  }
  function zoomBy(factor) {
    stopControlMomentum();
    regionCapture.cancel();
    flight = null;
    stopAuto();
    camera.position.setLength(
      clampCameraDistance(camera.position.length() * factor),
    );
    dirty = true;
  }
  $("globe-zoom-in").addEventListener("click", () => zoomBy(0.8));
  $("globe-zoom-out").addEventListener("click", () => zoomBy(1.25));
  $("globe-home").addEventListener("click", () => {
    stopControlMomentum();
    regionCapture.cancel();
    flight = null;
    camera.position.setLength(START_DIST);
    stopAuto();
    dirty = true;
  });
  canvas.addEventListener(
    "wheel",
    () => {
      regionCapture.cancel();
      flight = null;
      stopAuto();
    },
    { passive: true },
  );
  function pickSite(e) {
    if (mapMode === "regions") {
      const label = placedLabels.find(
        (b) =>
          e.clientX >= b.x0 &&
          e.clientX <= b.x1 &&
          e.clientY >= b.y0 &&
          e.clientY <= b.y1,
      );
      if (label) return label.r;
      let nearest = null,
        nearestDistance = 7;
      for (const r of regions) {
        if (!enabledGroups.has(r.group) || r._normal.dot(camera.position) <= 1)
          continue;
        const p = r._position.clone().project(camera);
        const distance = Math.hypot(
          (p.x * 0.5 + 0.5) * innerWidth - e.clientX,
          (-p.y * 0.5 + 0.5) * innerHeight - e.clientY,
        );
        if (distance < nearestDistance) {
          nearest = r;
          nearestDistance = distance;
        }
      }
      if (nearest) return nearest;
      const point = pickSurface(e);
      if (!point) return null;
      const n = latLonToVec(point.lat, point.lon);
      let best = null;
      for (const r of regions) {
        if (!enabledGroups.has(r.group)) continue;
        if (regionContains(r, n) && (!best || r.area.km2 < best.area.km2))
          best = r;
      }
      return best;
    }
    ndc.set(
      (e.clientX / innerWidth) * 2 - 1,
      -(e.clientY / innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    for (const h of raycaster.intersectObjects(hitTargets, false)) {
      const m = h.object.userData.mission;
      if (facing(m) > 1 / camera.position.length()) return m;
    }
    return null;
  }
  const tmp = new THREE.Vector3(),
    camDir = new THREE.Vector3();
  function facing(m) {
    camDir.copy(camera.position).normalize();
    return tmp.copy(m._ui.normal).dot(camDir);
  }
  canvas.addEventListener("pointerdown", (e) => {
    regionCapture.cancel();
    downAt = { x: e.clientX, y: e.clientY };
    flight = null;
    stopAuto();
  });
  let lastHoverTime = 0;
  canvas.addEventListener("pointermove", (e) => {
    if (zonesOpen || downAt || e.buttons) return;
    const now = performance.now();
    if (now - lastHoverTime < 65) return;
    lastHoverTime = now;
    if ($("planet-layer").value !== "surface")
      window.dispatchEvent(
        new CustomEvent("mars-pointer", { detail: pickSurface(e) }),
      );
    if (surfacePicker || mapMode === "routes") return;
    // Hover only decorates an already placed name. Area selection happens on click.
    const m =
      mapMode === "regions"
        ? placedLabels.find(
            (b) =>
              e.clientX >= b.x0 &&
              e.clientX <= b.x1 &&
              e.clientY >= b.y0 &&
              e.clientY <= b.y1,
          )?.r
        : pickSite(e);
    if (m !== hovered) {
      hovered = m;
      canvas.classList.toggle("pointing", !!m);
      dirty = true;
    }
  });
  canvas.addEventListener("pointercancel", () => {
    downAt = null;
  });
  window.addEventListener("pointerup", () => {
    downAt = null;
  });
  canvas.addEventListener("pointerleave", () => {
    hovered = null;
    canvas.classList.remove("pointing");
    dirty = true;
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!downAt || zonesOpen) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 5) return;
    if (surfacePicker) {
      const point = pickSurface(e);
      if (point) surfacePicker(point);
      return;
    }
    if (mapMode === "routes") return;
    const m = pickSite(e);
    if (m) {
      if (mapMode === "regions") selectRegion(m);
      else select(m);
    } else {
      if (selected) closeCard();
      if (selectedRegion) closeRegion();
    }
  });
  /* ---------- popup ---------- */
  const card = $("card");
  function select(m) {
    if (mapMode !== "missions") setMapMode("missions");
    selected = m;
    focusLocation(m.lat, m.lon, 1.65);
    $("mission-select").value = m.id;
    $("c-photo").src = m.photo.src;
    $("c-photo").alt = m.photo.alt;
    $("c-photo-link").href = m.photo.source;
    $("c-credit").textContent = `${m.photo.title} · ${m.photo.credit}`;
    $("c-kick").textContent = `${m.agency} · ${m.type} · ${m.year}`;
    $("c-name").textContent = m.name;
    $("c-site").textContent = `${m.site} · ${fmtLat(m.lat)} ${fmtLon(m.lon)}`;
    $("c-what").textContent = m.what;
    $("c-why").textContent = m.why;
    $("c-status").textContent = m.status;
    $("mission-environment").textContent = environmentText(m);
    $("c-note").textContent = m.zones
      ? "3 landing zones · HiRISE terrain · Curiosity science"
      : m.id === "perseverance"
        ? "Detailed walking planner available in Names → Valles Marineris."
        : "Explore Names → Valles Marineris for the detailed walking planner.";
    card.classList.remove("on");
    void card.offsetWidth;
    card.classList.add("on");
    for (const x of MISSIONS) x._ui.label.classList.toggle("sel", x === m);
    stopAuto();
    dirty = true;
  }
  function closeCard() {
    selected = null;
    card.classList.remove("on");
    for (const x of MISSIONS) x._ui.label.classList.remove("sel");
    dirty = true;
  }
  $("card-x").addEventListener("click", closeCard);
  $("planet-season").addEventListener("change", () => {
    if (selectedRegion)
      $("region-environment").textContent = environmentText(selectedRegion);
    if (selected)
      $("mission-environment").textContent = environmentText(selected);
  });

  /* ---------- zone picker ---------- */
  let zonesOpen = false;
  const zonesEl = $("zones");
  $("z-list").innerHTML = ZONES.map(
    (z) => `
    <a class="zone cut" href="mission.html?zone=${z.id}">
      <div class="z-img" style="background-image:url(assets/zones/${z.id}_thumb.jpg)"><span>${z.n}</span></div>
      <div class="z-body">
        <h3>${z.name}</h3>
        <div class="z-meta">${fmtLat(z.lat)} ${fmtLon(z.lon)} · ${z.rover}</div>
        <p>${z.objective}</p>
        <div class="z-row"><span>Hazards</span>${z.hazards}</div>
        <div class="z-row"><span>Difficulty</span><b class="d-${z.difficulty.toLowerCase()}">${z.difficulty}</b></div>
        <div class="z-go">Deploy rover →</div>
      </div>
    </a>`,
  ).join("");
  $("c-go").addEventListener("click", () => {
    closeRegion();
    closeCard();
    zonesOpen = true;
    document.body.classList.add("zoning");
    zonesEl.classList.add("on");
    zonesEl.querySelector(".zone").focus();
  });
  $("z-back").addEventListener("click", () => {
    zonesEl.classList.remove("on");
    document.body.classList.remove("zoning");
    zonesOpen = false;
    $("c-go").focus();
    auto = false;
    dirty = true;
  });

  /* ---------- labels and popup placement ---------- */
  const scr = new THREE.Vector3();
  function placeUi() {
    const w = innerWidth,
      h = innerHeight;
    const markerScale = Math.max(
      0.1,
      Math.min(1, (camera.position.length() - 1) / 2.4),
    );
    for (const m of MISSIONS) {
      const ui = m._ui;
      ui.group.scale.setScalar(markerScale);
      const f = facing(m);
      ui.group.getWorldPosition(scr).project(camera);
      const x = (scr.x * 0.5 + 0.5) * w,
        y = (-scr.y * 0.5 + 0.5) * h;
      const vis =
        f > 1 / camera.position.length() &&
        !zonesOpen &&
        m !== selected &&
        mapMode === "missions";
      ui.group.visible = !zonesOpen && mapMode === "missions";
      ui.label.style.opacity = vis ? Math.min(1, (f - 0.12) * 5) : 0;
      ui.label.style.transform = `translate(${x + 14}px, ${y - 8}px)`;
      const on = m === hovered || m === selected;
      ui.ring.scale.setScalar(on ? 1.5 : 1);
      ui.label.classList.toggle("hot", m === hovered);
    }
    updateRegionLabels();
  }

  /* ---------- auto-rotate ---------- */
  let auto = false,
    idleTimer = 0;
  function stopAuto() {
    auto = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!selected && !selectedRegion && !zonesOpen && mapMode !== "routes")
        auto = false;
    }, IDLE_RESUME_MS);
  }
  const AXIS = new THREE.Vector3(0, 1, 0);

  /* ---------- loop (draw only when something changes) ---------- */
  let dirty = true,
    last = performance.now();
  const lastCam = new THREE.Matrix4();
  controls.addEventListener("change", () => {
    dirty = true;
  });
  addEventListener("resize", resize);
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // Trackball rotation is angular: scale it with altitude so a close drag
    // travels a small ground distance instead of sweeping across a continent.
    const previousSpeed = controls.rotateSpeed;
    controls.rotateSpeed =
      2.2 *
      Math.min(
        1,
        Math.max(0.035, (camera.position.length() - 1) / (START_DIST - 1)),
      );
    if (
      controls.rotateSpeed < previousSpeed &&
      Number.isFinite(controls._lastAngle)
    )
      controls._lastAngle *= controls.rotateSpeed / previousSpeed;
    if (controls.enabled && !flight) controls.update();
    if (flight) {
      const t = Math.min(1, (now - flight.start) / 900);
      const ease = t * t * (3 - 2 * t);
      const rotation = new THREE.Quaternion().slerp(flight.rotation, ease);
      camera.position
        .copy(flight.direction)
        .applyQuaternion(rotation)
        .multiplyScalar(flight.from + (flight.to - flight.from) * ease);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      dirty = true;
      if (t === 1) {
        if (flight.regionCapture) regionCapture.capture();
        flight = null;
      }
    }
    if (
      auto &&
      !selected &&
      !selectedRegion &&
      !zonesOpen &&
      mapMode !== "routes"
    ) {
      camera.position.applyAxisAngle(AXIS, -AUTO_ROTATE_RAD_S * dt);
      camera.lookAt(0, 0, 0);
    }
    camera.updateMatrixWorld();
    if (!lastCam.equals(camera.matrixWorld)) {
      lastCam.copy(camera.matrixWorld);
      dirty = true;
      terrainTiles.schedule();
    }
    if (selectionLayer.update(now)) dirty = true;
    if (!dirty) return;
    dirty = false;
    placeUi();
    regionCapture.update();
    renderer.render(scene, camera);
  }

  camera.position.copy(latLonToVec(15, 120, START_DIST));
  camera.lookAt(0, 0, 0);
  resize();
  texReady
    .catch((e) => console.error("Mars texture failed", e))
    .finally(() => {
      $("boot").classList.add("done");
      document.body.classList.add("ready");
    });
  requestAnimationFrame(frame);
  window.__globe = {
    select,
    MISSIONS,
    regions,
    selectRegion,
    setMapMode,
    engine,
    planet,
    camera,
    renderer,
    terrainGeometry,
    positionAt,
    terrainTiles,
    setBasemap,
    get rotationSensitivity() {
      return controls.rotateSpeed;
    },
    focusLocation,
    setView,
    zoomBy,
    regionContains,
    enabledGroups,
    groupPoints,
    selectionLayer,
    regionCapture,
    areaMesh,
    get placedLabels() {
      return placedLabels;
    },
    get labelScale() {
      return { index: activeLabelLevel, ...LABEL_LEVELS[activeLabelLevel] };
    },
    get selectedRegion() {
      return selectedRegion;
    },
    markDirty: () => {
      dirty = true;
    },
    setPicker: (callback) => {
      surfacePicker = callback;
      canvas.classList.toggle("picking-route", !!callback);
      stopAuto();
    },
  }; // used by headless checks
})();
