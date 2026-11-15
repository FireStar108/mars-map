'use strict';
(function (PG) {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const zone = (window.ZONES || []).find((item) => item.id === params.get('zone'));
  const WARP_STEPS = [1, 10, 25, 50];
  const CHECKPOINTS = {
    boxwork: ['Ridge approach', 'Mineral outcrop', 'Survey station'],
    gediz: ['Channel rim', 'Sulfur-bearing rocks', 'Field station'],
    uncharted: ['First survey point', 'Sulfate slope', 'Frontier marker'],
  };
  const MAP_LAYERS = {
    slope: { unit: '°', digits: 1 },
    groundT: { unit: '°C', digits: 1 },
    dose: { unit: 'µGy/h', digits: 2 },
  };
  const $text = (id, value) => { $(id).textContent = value; };

  class MarswalkGame {
    constructor() {
      this.stage = 'boot';
      this.warp = 25;
      this.path = [];
      this.roverSamples = [];
      this.visited = new Set();
      this.anchors = [];
      this.walkTasks = [];
      this.cameraOrbit = { yaw: 0, pitch: 0.34, distance: 13 };
      this.last = 0;
      this.hudTimer = 0;
      this.drag = null;
      this.mapImage = new Image();
    }

    async init() {
      if (!zone) throw new Error('Choose a valid landing zone from the globe.');
      $('boot-zone').textContent = `${zone.name} · Gale crater`;
      this.setBoot(4, 'Loading HiRISE terrain data…');
      await this.loadZoneData();

      this.renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.scene = new THREE.Scene();
      this.input = new PG.Input();
      this.physics = new PG.Physics();
      await this.physics.init();

      this.setBoot(22, 'Building the real Gale crater surface…');
      this.terrain = new PG.ZoneTerrain(window.ZONE_DATA);
      this.scene.add(this.terrain.buildMesh(this.renderer));
      for (const mesh of this.terrain.scatterRocks([
        { x: 8, z: -30, r: 25 },
        { x: 0, z: 0, r: 7 },
      ])) this.scene.add(mesh);
      this.terrain.buildColliders(this.physics);

      this.setBoot(48, 'Constructing the habitat and rover…');
      this.tracks = new PG.Tracks(this.scene, this.terrain);
      this.environment = new PG.Environment(this.scene);
      this.bus = new PG.Bus();
      this.clock = new PG.MarsClock(9.6);
      this.sun = new THREE.Vector3();
      this.clock.sunDir(this.sun);
      this.weather = new PG.Weather();
      this.env = new PG.Env(this.terrain, this.weather);
      this.habitat = PG.buildHabitat(this.terrain, 8, -30, 0);
      this.scene.add(this.habitat);
      this.checkpoints = this.makeCheckpoints();
      this.checkpoints.forEach((point) => this.addBeacon(point));
      this.camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.05, 9000);
      this.resize();

      this.setBoot(65, 'Loading Curiosity…');
      const roverModel = await PG.loadGLB('curiosity');
      this.rover = new PG.Rover({
        scene: this.scene,
        physics: this.physics,
        terrain: this.terrain,
        tracks: this.tracks,
        bus: this.bus,
      }, roverModel, { x: 0, z: 0, yaw: 0 });
      for (let i = 0; i < 90; i++) this.physics.step(1 / 60);
      this.rover.update(1 / 60, 1 / 60);

      this.walker = new PG.Walker(this);
      this.walker.backtrackRange = Number.MAX_SAFE_INTEGER;
      await this.loadMapImage();
      this.bindUi();
      this.prepareHud();
      this.updateLighting();
      this.beginScout();
      this.updateCamera(1);
      this.updateHud();
      this.setBoot(100, 'Ready for deployment');
      $('boot').classList.add('done');
      this.last = performance.now();
      requestAnimationFrame((time) => this.frame(time));
    }

    async loadZoneData() {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `assets/zones/${zone.id}.js`;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Could not load terrain data for ${zone.name}.`));
        document.head.appendChild(script);
      });
      if (!window.ZONE_DATA || window.ZONE_DATA.id !== zone.id) {
        throw new Error(`Terrain data does not match the selected zone (${zone.id}).`);
      }
    }

    loadMapImage() {
      return new Promise((resolve, reject) => {
        this.mapImage.onload = resolve;
        this.mapImage.onerror = () => reject(new Error(`Could not load the HiRISE map for ${zone.name}.`));
        this.mapImage.src = `assets/zones/${zone.id}_thumb.jpg`;
      });
    }

    setBoot(progress, message) {
      $('boot-fill').style.width = `${progress}%`;
      $text('boot-msg', message);
    }

    prepareHud() {
      $text('h-zone', `${zone.name} · Gale crater`);
      $('cps').innerHTML = this.checkpoints.map((point, index) =>
        `<div class="cp" id="cp-${index}">${point.name}</div>`).join('');
      $('warp').innerHTML = WARP_STEPS.map((warp) =>
        `<button type="button" data-warp="${warp}" aria-label="Set simulation speed to ${warp} times">×${warp}</button>`).join('');
      $('warp').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-warp]');
        if (button) this.warp = Number(button.dataset.warp);
      });
      $('r-layer').addEventListener('change', () => this.drawRouteMap());
    }

    makeCheckpoints() {
      const names = CHECKPOINTS[zone.id] || ['Survey point 1', 'Survey point 2', 'Field station'];
      return [
        { id: 'beacon-1', name: names[0], x: -90, z: -110 },
        { id: 'beacon-2', name: names[1], x: 100, z: -140 },
        { id: 'beacon-3', name: names[2], x: 135, z: 100 },
      ];
    }

    addBeacon(point) {
      const y = this.terrain.heightAt(point.x, point.z);
      const group = new THREE.Group();
      const color = new THREE.Color(point.id === 'beacon-3' ? '#ff7a4c' : '#4fe3ff');
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(.13, .22, 4.5, 8),
        new THREE.MeshStandardMaterial({ color: 0xb9a797, metalness: .35, roughness: .65 }),
      );
      mast.position.y = 2.25;
      group.add(mast);
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(.38, 12, 8),
        new THREE.MeshBasicMaterial({ color }),
      );
      beacon.position.y = 4.7;
      group.add(beacon);
      group.add(new THREE.PointLight(color, 3.5, 18));
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(3.2, .08, 8, 36),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .8 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = .14;
      group.add(ring);
      group.position.set(point.x, y, point.z);
      point.group = group;
      this.scene.add(group);
    }

    bindUi() {
      $('st-close').addEventListener('click', () => {
        $('stop').classList.remove('on');
        this.stage = 'rover';
      });
      $('end-scout').addEventListener('click', () => this.openReport());
      $('r-auto').addEventListener('click', () => this.planSaferRoute());
      $('r-redrive').addEventListener('click', () => this.returnToRover());
      $('r-walk').addEventListener('click', () => this.beginWalk());
      $('v-photo').addEventListener('click', () => this.completeWalkTask('photo'));
      $('v-sample').addEventListener('click', () => this.completeWalkTask('sample'));
      $('d-again').addEventListener('click', () => { location.href = 'index.html'; });
      addEventListener('resize', () => this.resize());
      this.bindCameraDrag();
      this.bindRouteEditor();
    }

    bindCameraDrag() {
      const canvas = $('scene');
      let pointer = null;
      canvas.addEventListener('pointerdown', (event) => {
        if (this.stage !== 'rover' || event.button !== 0) return;
        pointer = { x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
      });
      canvas.addEventListener('pointermove', (event) => {
        if (!pointer || this.stage !== 'rover') return;
        const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
        pointer = { x: event.clientX, y: event.clientY };
        this.cameraOrbit.yaw -= dx * .005;
        this.cameraOrbit.pitch = PG.clamp(this.cameraOrbit.pitch + dy * .004, .05, 1.2);
      });
      const release = () => { pointer = null; };
      canvas.addEventListener('pointerup', release);
      canvas.addEventListener('pointercancel', release);
    }

    bindRouteEditor() {
      const canvas = $('r-canvas');
      canvas.addEventListener('pointerdown', (event) => {
        if (this.stage !== 'report' || this.anchors.length < 3) return;
        const point = this.canvasPoint(canvas, event);
        const handle = this.worldToMap(this.anchors[1], canvas);
        if (Math.hypot(point.x - handle.x, point.y - handle.y) > 18) return;
        this.drag = { ...this.anchors[1] };
        canvas.setPointerCapture(event.pointerId);
      });
      canvas.addEventListener('pointermove', (event) => {
        if (!this.drag) return;
        this.anchors[1] = this.mapToWorld(this.canvasPoint(canvas, event), canvas);
        this.drawRouteMap();
      });
      canvas.addEventListener('pointerup', () => {
        if (!this.drag) return;
        const old = this.drag;
        this.drag = null;
        if (!this.planSaferRoute()) { this.anchors[1] = old; this.drawRouteMap(); }
      });
      canvas.addEventListener('pointercancel', () => {
        if (!this.drag) return;
        this.anchors[1] = this.drag;
        this.drag = null;
        this.drawRouteMap();
      });
    }

    canvasPoint(canvas, event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    worldToMap(point, canvas) {
      const half = this.terrain.half;
      return {
        x: ((point.x + half) / this.terrain.size) * canvas.clientWidth,
        y: ((point.z + half) / this.terrain.size) * canvas.clientHeight,
      };
    }

    mapToWorld(point, canvas) {
      const half = this.terrain.half;
      return {
        x: PG.clamp(point.x / canvas.clientWidth * this.terrain.size - half, -half + 8, half - 8),
        z: PG.clamp(point.y / canvas.clientHeight * this.terrain.size - half, -half + 8, half - 8),
      };
    }

    beginScout() {
      this.stage = 'rover';
      this.path = [{ x: this.rover.group.position.x, z: this.rover.group.position.z }];
      this.roverSamples = [this.makeRoverSample(this.path[0])];
      this.lastCaptured = { ...this.path[0] };
      this.checkpointSampleStart = 0;
      document.body.classList.add('phase-rover');
      this.rover.setVisible(true);
      this.toast('WASD to drive · reach three beacons, review the route, then walk it.', 'ok');
    }

    makeRoverSample(point) {
      return {
        x: point.x,
        z: point.z,
        s: this.env.sample(point.x, point.z, this.clock, this.sun, this.wx),
      };
    }

    controls() {
      const forward = this.input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
      const turn = this.input.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
      if (this.input.pressed('KeyT')) {
        const index = WARP_STEPS.indexOf(this.warp);
        this.warp = WARP_STEPS[(index + 1) % WARP_STEPS.length];
      }
      if (this.input.is('Space')) {
        this.rover.setDrive(0, 0);
        return;
      }
      if (forward) {
        this.rover.setDrive(
          forward * PG.ROVER_TOP_SPEED,
          turn * PG.ROVER_TOP_SPEED / 2.6 * Math.sign(forward),
        );
      } else {
        this.rover.setDrive(0, turn * PG.ROVER_TOP_SPEED / 1.65);
      }
    }

    updateRoverPath() {
      const p = this.rover.group.position;
      const moved = Math.hypot(p.x - this.lastCaptured.x, p.z - this.lastCaptured.z);
      if (moved >= .8) {
        const point = { x: p.x, z: p.z };
        this.path.push(point);
        this.roverSamples.push(this.makeRoverSample(point));
        this.lastCaptured = point;
      }
      this.checkpoints.forEach((checkpoint, index) => {
        if (index === this.visited.size && !this.visited.has(checkpoint.id) && Math.hypot(p.x - checkpoint.x, p.z - checkpoint.z) < 10) {
          this.visited.add(checkpoint.id);
          $(`cp-${index}`).classList.add('done');
          this.showCheckpointReport(checkpoint);
        }
      });
      $('end-scout').disabled = this.visited.size !== this.checkpoints.length;
    }

    showCheckpointReport(checkpoint) {
      const samples = this.roverSamples.slice(this.checkpointSampleStart).map(({ s }) => s);
      samples.push(this.env.sample(checkpoint.x, checkpoint.z, this.clock, this.sun, this.wx));
      this.checkpointSampleStart = this.roverSamples.length;
      const average = (key) => samples.reduce((sum, item) => sum + item[key], 0) / samples.length;
      const worstSlope = Math.max(...samples.map((item) => item.slope));
      const worstRating = Math.max(...samples.map((item) => this.env.rate(item).lvl));
      const rating = PG.LEVEL[worstRating];
      $text('st-kick', 'Survey checkpoint · ' + this.visited.size + ' / 3');
      $text('st-name', checkpoint.name);
      $text('st-text', rating.name + ' terrain. ' + (worstRating === 2
        ? 'Review the steep or uneven stretches before the astronaut traverse.'
        : 'Continue surveying and compare this section with the next.'));
      $('st-text').style.color = rating.color;
      $('st-dl').innerHTML = [
        ['Maximum slope', worstSlope.toFixed(1) + '°'],
        ['Average roughness', (average('rough') * 100).toFixed(1) + ' cm'],
        ['Ground temperature · model', average('groundT').toFixed(1) + ' °C'],
        ['Radiation rate · model', average('dose').toFixed(2) + ' µGy/h'],
        ['Readings along this section', samples.length],
      ].map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('');
      this.rover.setDrive(0, 0);
      this.stage = 'checkpoint';
      $('stop').classList.add('on');
    }

    openReport() {
      if (this.visited.size !== this.checkpoints.length) return;
      const end = this.rover.group.position;
      const last = this.path[this.path.length - 1];
      if (!last || Math.hypot(last.x - end.x, last.z - end.z) > .3) {
        this.path.push({ x: end.x, z: end.z });
        this.roverSamples.push(this.makeRoverSample(end));
      }
      const route = PG.Route.simplify(this.path, 2);
      if (route.length < 2) {
        this.toast('The rover did not record enough movement to create a route.', 'err');
        return;
      }
      this.rover.setDrive(0, 0);
      this.stage = 'report';
      this.route = route;
      this.anchors = [route[0], this.pointAtFraction(route, .5), route[route.length - 1]].map((p) => ({ x: p.x, z: p.z }));
      $('report').classList.add('on');
      document.body.classList.add('phase-report');
      this.evaluateRoute();
      requestAnimationFrame(() => this.drawRouteMap());
    }

    pointAtFraction(points, fraction) {
      const total = PG.Route.length(points);
      const target = total * fraction;
      let distance = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (distance + length >= target) {
          const t = length ? (target - distance) / length : 0;
          return { x: PG.lerp(a.x, b.x, t), z: PG.lerp(a.z, b.z, t) };
        }
        distance += length;
      }
      return { ...points[points.length - 1] };
    }

    planSaferRoute() {
      const first = PG.Route.plan(this.env, this.anchors[0], this.anchors[1], this);
      const second = PG.Route.plan(this.env, this.anchors[1], this.anchors[2], this);
      if (!first || !second) {
        $('r-tip').textContent = 'No safe path found for this handle position. Try another point.';
        this.toast('No safe route found. Move the handle to a different area.', 'warn');
        return false;
      }
      this.route = first.concat(second.slice(1));
      this.evaluateRoute();
      this.drawRouteMap();
      return true;
    }

    evaluateRoute() {
      const verifier = new PG.Route.Verifier(this.roverSamples);
      this.routeEval = PG.Route.evaluate(this.route, {
        env: this.env,
        clock: this.clock,
        sun: this.sun,
        wx: this.wx,
      }, verifier);
      this.renderReportStats();
    }

    renderReportStats() {
      const stats = this.routeEval.stats;
      const minutes = Math.round(stats.time / 60);
      $('r-title').textContent = `${zone.name} · Route report`;
      $('r-stats').innerHTML = [
        ['Rover distance', `${this.rover.odometer.toFixed(0)} m`],
        ['Planned route', `${stats.length.toFixed(0)} m`],
        ['Excellent ground', `${stats.pct[0].toFixed(0)}%`],
        ['Max slope', `${stats.maxSlope.toFixed(1)}°`],
        ['Modeled EVA dose', `${stats.dose.toFixed(2)} µGy`],
        ['Rover coverage', `${stats.verifiedPct.toFixed(0)}%`],
      ].map(([label, value]) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`).join('');
      $('r-bar').innerHTML = PG.LEVEL.map((level, index) =>
        `<i title="${level.name}: ${stats.pct[index].toFixed(0)}%" style="width:${stats.pct[index]}%;background:${level.color}"></i>`).join('');
      $('r-segs').innerHTML = this.routeEval.segs.map((segment) => {
        const level = PG.LEVEL[segment.lvl];
        const reasons = segment.why.map(({ msg }) => msg).join(' · ');
        return `<div class="r-seg"><i style="background:${level.color}"></i>
          <span>${segment.d0.toFixed(0)}–${segment.d1.toFixed(0)} m · ${level.name}${reasons ? `<br>${reasons}` : ''}</span>
          <b>${segment.verified ? 'ROVER-SCOUTED' : 'ORBITAL DATA'}</b></div>`;
      }).join('');
      $('r-tip').textContent = `${this.visited.size} beacons logged · estimated EVA ${minutes} min`;
    }

    drawRouteMap() {
      const canvas = $('r-canvas');
      if (!canvas.clientWidth || !canvas.clientHeight || !this.route) return;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const width = canvas.clientWidth, height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(this.mapImage, 0, 0, width, height);
      ctx.fillStyle = 'rgba(10, 6, 5, .2)';
      ctx.fillRect(0, 0, width, height);

      const xy = (point) => this.worldToMap(point, canvas);
      const samples = this.routeEval.samples;
      const key = $('r-layer').value;
      const layer = MAP_LAYERS[key];
      let min = Infinity, max = -Infinity;
      document.querySelector('.r-legend').classList.toggle('metric', !!layer);
      if (layer) {
        for (const { s } of samples) {
          min = Math.min(min, s[key]);
          max = Math.max(max, s[key]);
        }
      }
      $text('r-layer-range', layer
        ? `Blue ${min.toFixed(layer.digits)} → orange ${max.toFixed(layer.digits)} ${layer.unit}`
        : 'HiRISE stereo terrain · ~1 m/pixel');
      for (let i = 1; i < samples.length; i++) {
        const a = xy(samples[i - 1]), b = xy(samples[i]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        const fraction = layer ? (samples[i].s[key] - min) / (max - min || 1) : 0;
        ctx.strokeStyle = layer ? `hsl(${205 - 177 * fraction} 95% 64%)` : PG.LEVEL[samples[i].r.lvl].color;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      this.path.forEach((point, index) => {
        const p = xy(point);
        if (!index) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      this.anchors.forEach((point, index) => {
        const p = xy(point);
        ctx.beginPath();
        ctx.arc(p.x, p.y, index === 1 ? 8 : 5, 0, Math.PI * 2);
        ctx.fillStyle = index === 1 ? '#fff' : '#4fe3ff';
        ctx.fill();
        ctx.strokeStyle = '#09080a';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }

    returnToRover() {
      $('report').classList.remove('on');
      document.body.classList.remove('phase-report');
      this.stage = 'rover';
      this.rover.setVisible(true);
      this.toast('Back at the rover. Continue scouting or return to the route report.', 'info');
    }

    beginWalk() {
      if (!this.routeEval) return;
      this.rover.setDrive(0, 0);
      this.rover.setVisible(false);
      $('report').classList.remove('on');
      $('visor').classList.add('on');
      document.body.classList.remove('phase-report');
      document.body.classList.add('phase-walk');
      this.stage = 'walk';
      this.walker.warp = 1;
      this.walkReachedEnd = false;
      this.walker.start(this.route, this.routeEval);
      this.walker.update(0, this.input);
      this.walker.backtrackRange = this.routeEval.samples.length;
      const samples = this.routeEval.samples;
      this.walkTasks = [
        { id: 'photo', name: 'Photograph the mineral ridge', point: this.sampleAtFraction(samples, .34), done: false },
        { id: 'sample', name: 'Collect a rock sample', point: this.sampleAtFraction(samples, .72), done: false },
      ];
      this.walkTasks.forEach((task) => this.addTaskMarker(task));
      this.toast('EVA started. Follow the route and complete both field objectives.', 'info');
    }

    sampleAtFraction(samples, fraction) {
      const index = Math.min(samples.length - 1, Math.floor((samples.length - 1) * fraction));
      const sample = samples[index];
      return { x: sample.x, z: sample.z };
    }

    addTaskMarker(task) {
      const y = this.terrain.heightAt(task.point.x, task.point.z) + .2;
      const color = task.id === 'photo' ? 0x4fe3ff : 0x7dff8a;
      const marker = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.7, .12, 8, 32),
        new THREE.MeshBasicMaterial({ color }),
      );
      ring.rotation.x = Math.PI / 2;
      marker.add(ring);
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(.07, .12, 2.1, 8),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .35 }),
      );
      post.position.y = 1.1;
      marker.add(post);
      marker.position.set(task.point.x, y, task.point.z);
      task.group = marker;
      this.scene.add(marker);
    }

    nearestTask() {
      if (!this.walker) return null;
      return this.walkTasks
        .filter((task) => !task.done)
        .map((task) => ({ task, distance: Math.hypot(task.point.x - this.walker.pos.x, task.point.z - this.walker.pos.z) }))
        .sort((a, b) => a.distance - b.distance)[0] || null;
    }

    completeWalkTask(id) {
      if (this.stage !== 'walk') return;
      const task = this.walkTasks.find((item) => item.id === id);
      if (!task || task.done || Math.hypot(task.point.x - this.walker.pos.x, task.point.z - this.walker.pos.z) > 7) return;
      if (id === 'photo') {
        this.renderer.render(this.scene, this.walker.camera);
        $('d-photo').href = this.renderer.domElement.toDataURL('image/png');
      }
      task.done = true;
      task.group.visible = false;
      this.toast(id === 'photo' ? 'Photo captured and added to the mission log.' : 'Rock sample collected and secured.', 'ok');
      this.updateWalkHud();
      if (this.walkReachedEnd && this.walkTasks.every((item) => item.done)) this.completeMission();
    }

    walkAlert(location) {
      $('v-alert').textContent = location
        ? 'Solar particle event · move to the marked terrain shelter.'
        : 'Solar particle event · stay low and limit EVA exposure.';
      $('v-alert').classList.add('on');
      this.toast('Space-weather alert: protect the crew and monitor exposure.', 'warn');
      setTimeout(() => $('v-alert').classList.remove('on'), 9000);
    }

    toast(message, kind = 'info') {
      const toast = document.createElement('div');
      toast.className = `toast ${kind}`;
      toast.textContent = message;
      $('toasts').appendChild(toast);
      setTimeout(() => toast.remove(), 4200);
    }

    completeMission() {
      if (this.stage === 'done') return;
      this.stage = 'done';
      this.walker.stop();
      $('visor').classList.remove('on');
      document.body.classList.remove('phase-walk');
      const stats = this.routeEval.stats;
      $('d-stats').innerHTML = [
        ['Rover traverse', `${this.rover.odometer.toFixed(0)} m`],
        ['Astronaut route', `${stats.length.toFixed(0)} m`],
        ['Photo', 'Captured'],
        ['Rock sample', 'Collected'],
        ['EVA exposure', `${this.walker.dose.toFixed(2)} µGy`],
      ].map(([label, value]) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`).join('');
      $text('d-text', `Curiosity scouted ${zone.name}, the route was reviewed against HiRISE terrain, and the astronaut completed both field objectives.`);
      $('done').classList.add('on');
    }

    updateWalkHud() {
      const nearest = this.nearestTask();
      const inReach = nearest && nearest.distance <= 7;
      $('v-photo').disabled = !inReach || nearest.task.id !== 'photo';
      $('v-sample').disabled = !inReach || nearest.task.id !== 'sample';
      if (nearest) {
        const distance = nearest.distance < 10 ? `${nearest.distance.toFixed(1)} m` : `${Math.round(nearest.distance)} m`;
        $text('v-wp', `${nearest.task.done ? 'Objective complete' : nearest.task.name} · ${distance}`);
      } else {
        $text('v-wp', 'All field objectives complete');
      }
      const next = this.walker.samples[Math.min(this.walker.progress + 2, this.walker.samples.length - 1)];
      const remaining = Math.max(0, this.walker.samples[this.walker.samples.length - 1].d - (next ? next.d : 0));
      $text('v-seg', `${remaining.toFixed(0)} m to route end · ${this.walkTasks.filter((task) => task.done).length}/2 objectives · time ×${this.walker.warp}`);
      $('v-suit').innerHTML = `O₂ <b>${(this.walker.o2 * 1000).toFixed(0)} g</b><br>Heart rate <b>${this.walker.hr.toFixed(0)} bpm</b><br>Radiation <b>${this.walker.dose.toFixed(2)} µGy</b>`;
      const here = this.walker.here || { groundT: -34, dose: 0 };
      $('v-envr').innerHTML = `Ground <b>${here.groundT.toFixed(1)} °C</b><br>Exposure <b>${here.dose.toFixed(2)} µGy/h</b><br>Off route <b>${this.walker.offRoute.toFixed(1)} m</b>`;
      const heading = ((this.walker.yaw / PG.DEG) % 360 + 360) % 360;
      $text('v-tape', `${String(Math.round(heading)).padStart(3, '0')}° · N`);
    }

    updateHud() {
      const p = this.rover.group.position;
      const readings = this.env.sample(p.x, p.z, this.clock, this.sun, this.wx);
      const { slope: current, rough } = readings;
      const next = this.checkpoints.find((point) => !this.visited.has(point.id));
      const distance = next ? Math.hypot(p.x - next.x, p.z - next.z) : 0;
      $('sensors').innerHTML = `<h3>Rover telemetry</h3><dl>
        <dt>Drive speed</dt><dd>${(Math.abs(this.rover.speed) * 100).toFixed(1)} cm/s</dd>
        <dt>Ground temp. (model)</dt><dd>${readings.groundT.toFixed(1)} °C</dd>
        <dt>Radiation (model)</dt><dd>${readings.dose.toFixed(2)} µGy/h</dd>
        <dt>Distance</dt><dd>${this.rover.odometer.toFixed(1)} m</dd>
        <dt>Ground slope</dt><dd>${current.toFixed(1)}°</dd>
        <dt>Surface roughness</dt><dd>${(rough * 100).toFixed(0)} cm</dd>
        <dt>Time rate</dt><dd>×${this.warp}</dd>
      </dl>`;
      $text('nb-label', next ? next.name : 'All beacons reached');
      $text('nb-dist', next ? `${Math.round(distance)} m` : 'ROUTE READY');
      $('nb-arrow').hidden = !next;
      if (next) {
        const angle = Math.atan2(next.x - p.x, p.z - next.z) + this.rover.heading() + this.cameraOrbit.yaw;
        $('nb-arrow').style.transform = `rotate(${angle}rad)`;
      }
      $text('t-sol', String(this.clock.sol));
      $text('t-lmst', this.clock.lmst());
      document.querySelectorAll('#warp button').forEach((button) => {
        button.classList.toggle('on', Number(button.dataset.warp) === this.warp);
      });
      $text('rating-now', `HiRISE terrain · ${current.toFixed(1)}° slope · ${rough > .14 ? 'rough ground' : 'route open'}`);
      this.drawMiniMap();
    }

    drawMiniMap() {
      const canvas = $('minimap');
      const ctx = canvas.getContext('2d');
      const size = canvas.width;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = 'rgba(7, 5, 5, .88)';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(this.mapImage, 0, 0, size, size);
      const toPoint = (point) => ({
        x: (point.x + this.terrain.half) / this.terrain.size * size,
        y: (point.z + this.terrain.half) / this.terrain.size * size,
      });
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = '#ffdb9c';
      ctx.beginPath();
      ctx.moveTo(toPoint({x:0,z:0}).x, toPoint({x:0,z:0}).y);
      for (const cp of this.checkpoints) { const p = toPoint(cp); ctx.lineTo(p.x, p.y); }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      this.path.forEach((point, index) => {
        const p = toPoint(point);
        if (!index) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      this.checkpoints.forEach((checkpoint, index) => {
        const p = toPoint(checkpoint);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = this.visited.has(checkpoint.id) ? '#7dff8a' : '#4fe3ff';
        ctx.fill();
        ctx.font = 'bold 16px sans-serif';
        ctx.strokeStyle = '#18130f'; ctx.lineWidth = 3;
        ctx.strokeText(String(index + 1), p.x + 8, p.y + 5);
        ctx.fillText(String(index + 1), p.x + 8, p.y + 5);
      });
      const rover = toPoint(this.rover.group.position);
      ctx.beginPath();
      ctx.arc(rover.x, rover.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }

    updateLighting() {
      this.clock.sunDir(this.sun);
      this.wx = this.weather.read(this.clock, this.sun);
      this.environment.update(this.sun, this.stage === 'walk' ? this.walker.pos : this.rover.group.position);
    }

    updateCamera(dt) {
      const focus = this.rover.group.position.clone().add(new THREE.Vector3(0, 1.2, 0));
      const yaw = this.rover.heading() + this.cameraOrbit.yaw;
      const pitch = this.cameraOrbit.pitch;
      const distance = this.cameraOrbit.distance;
      const desired = new THREE.Vector3(
        Math.sin(yaw) * Math.cos(pitch) * distance,
        Math.sin(pitch) * distance,
        Math.cos(yaw) * Math.cos(pitch) * distance,
      ).add(focus);
      const ground = this.terrain.heightAt(desired.x, desired.z) + .8;
      desired.y = Math.max(desired.y, ground);
      this.camera.position.lerp(desired, 1 - Math.exp(-dt * 5));
      this.camera.lookAt(focus);
    }

    resize() {
      if (!this.renderer) return;
      const width = innerWidth, height = innerHeight;
      this.renderer.setSize(width, height);
      if (this.camera) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      }
      if (this.walker) {
        this.walker.camera.aspect = width / height;
        this.walker.camera.updateProjectionMatrix();
      }
      if (this.stage === 'report') requestAnimationFrame(() => this.drawRouteMap());
    }

    frame(now) {
      requestAnimationFrame((time) => this.frame(time));
      const dt = Math.min(.05, (now - this.last) / 1000);
      this.last = now;
      if (this.stage === 'rover') {
        this.controls();
        const simDt = this.physics.step(dt * this.warp);
        this.clock.advance(simDt);
        this.updateLighting();
        this.rover.update(dt, simDt);
        this.updateRoverPath();
        this.updateCamera(dt);
        this.hudTimer -= dt;
        if (this.hudTimer <= 0) {
          this.hudTimer = .12;
          this.updateHud();
        }
      } else if (this.stage === 'walk') {
        const simDt = dt * this.walker.warp;
        this.physics.step(dt);
        this.clock.advance(simDt);
        this.env.update(simDt);
        this.updateLighting();
        this.walkReachedEnd = this.walker.update(dt, this.input);
        if (this.input.pressed('KeyE')) {
          const task = this.nearestTask();
          if (task && task.distance <= 7) this.completeWalkTask(task.task.id);
        }
        this.updateWalkHud();
        if (this.walkReachedEnd && this.walkTasks.every((task) => task.done)) this.completeMission();
      }
      this.input.endFrame();

      if (this.stage === 'rover' || this.stage === 'checkpoint') {
        this.renderer.render(this.scene, this.camera);
      } else if (this.stage === 'walk') {
        this.renderer.render(this.scene, this.walker.camera);
      }
    }
  }

  const game = new MarswalkGame();
  window.__marswalk = game;
  game.init().catch((error) => {
    console.error('Marswalk failed to start:', error);
    $('boot-msg').className = 'err';
    $('boot-msg').textContent = `Mission loading failed: ${error.message}`;
  });
})(window.PG);
