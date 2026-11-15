'use strict';
// Сборка полигона: рендер, физика, поверхность, машины, приборы, ввод и главный цикл.
(function (PG) {
  const WARPS = [1, 10, 50, 100];

  class App {
    async init() {
      const step = (pct, msg) => {
        document.getElementById('boot-fill').style.width = pct + '%';
        document.getElementById('boot-msg').textContent = msg;
        return new Promise((r) => requestAnimationFrame(() => r()));
      };
      await step(5, 'Рендер и физический движок Rapier…');
      const canvas = document.getElementById('scene');
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.scene = new THREE.Scene();
      this.bus = new PG.Bus();
      this.input = new PG.Input();
      this.physics = new PG.Physics();
      await this.physics.init();

      await step(20, 'Рельеф полигона 400 × 400 м…');
      this.terrain = new PG.ProceduralTerrain();
      this.scene.add(this.terrain.buildMesh());
      for (const m of this.terrain.scatterRocks()) this.scene.add(m);
      await step(40, 'Коллайдеры рельефа и камней…');
      this.terrain.buildColliders(this.physics);
      this.env = new PG.Environment(this.scene);
      this.tracks = new PG.Tracks(this.scene, this.terrain);
      this.dust = new PG.Particles(this.scene, { max: 2500, gravity: 0.15, drag: 0.5, color: 0xb98060 });
      this.fire = new PG.Particles(this.scene, { max: 900, additive: true, gravity: -0.1, drag: 3, color: 0xff6a1a });

      await step(55, 'Модели: Curiosity, багги, пилот…');
      const [gR, gB, gA] = await Promise.all([PG.loadGLB('curiosity'), PG.loadGLB('buggy'), PG.loadGLB('alien')]);
      await step(80, 'Сборка машин…');
      const ctx = { scene: this.scene, physics: this.physics, terrain: this.terrain, tracks: this.tracks, dust: this.dust, fire: this.fire, bus: this.bus };
      this.rover = new PG.Rover(ctx, gR, { x: 0, z: 0, yaw: 0 });
      this.buggy = new PG.Buggy(ctx, gB, gA, { x: 7, z: 5, yaw: 0.5 });
      this.active = this.rover;

      this.clock = new PG.MarsClock(9.6);
      this.wx = null;
      this.weather = new PG.Weather();
      this.power = new PG.Power();
      this.comms = new PG.Comms();
      this.danPassive = 0;
      this.warp = 1; this.warpEffective = 1;
      this.tool = null;
      this.ops = new PG.Ops(this);
      this.views = new PG.Views(this);
      this.hud = new PG.Hud(this);
      this.sun = new THREE.Vector3();
      // устаканиваем подвески до первого кадра
      for (let i = 0; i < 120; i++) this.physics.step(1 / 60);

      await step(100, 'Готово');
      document.getElementById('boot').classList.add('done');
      this.ops.log('Curiosity на полигоне. W/S — ехать (4 см/с), T — ускорить время, Tab — багги', 'info');
      this.last = performance.now();
      this.t = 0;
      addEventListener('keydown', (e) => { if (e.code === 'Escape') { this.setTool(null); this.ops.abort(); document.getElementById('modal').classList.remove('on'); } });
      requestAnimationFrame((t) => this.frame(t));
    }

    setActive(kind) {
      const next = kind === 'buggy' ? this.buggy : this.rover;
      if (next === this.active) return;
      this.active = next;
      this.setTool(null);
      if (kind === 'buggy') { this.roverWarp = this.warp; this.setWarp(1); this.rover.setDrive(0, 0); this.ops.cancelNav(); }
      else this.setWarp(this.roverWarp || 1);
      this.buggy.input = { throttle: 0, steer: 0, brake: true, rocket: false };
      this.views.orbit.init = false;
      this.views.setMode('chase');
      this.hud.setVehicle(kind);
    }
    setWarp(w) {
      if (this.active.kind === 'buggy') w = 1;
      this.warp = w;
      this.hud && this.hud.setWarp(w);
    }
    setTool(t) {
      if (t && this.active.kind !== 'rover') return;
      this.tool = t;
      this.bus.emit('tool', t);
    }
    action(a) {
      const O = this.ops;
      switch (a) {
        case 'sam': O.deliver('SAM'); break;
        case 'chemin': O.deliver('CheMin'); break;
        case 'dan': O.dan(); break;
        case 'pano': O.panorama(); break;
        case 'selfie': O.selfie(); break;
        case 'stow': O.run('Укладка руки', () => O.stow()); break;
      }
    }

    onClick(x, y) {
      if (!this.tool || this.active.kind !== 'rover') return;
      const hit = this.terrain.pick(this.views.ray(x, y));
      if (!hit) return;
      const t = this.tool;
      this.setTool(null);
      if (t === 'nav') this.ops.navigate(hit.point);
      else this.ops[t](hit);
    }

    controls() {
      const I = this.input;
      if (I.pressed('Tab') || I.pressed('KeyV')) this.setActive(this.active.kind === 'rover' ? 'buggy' : 'rover');
      if (I.pressed('KeyC')) this.views.cycle(I.is('ShiftLeft', 'ShiftRight') && this.active.kind === 'rover' ? -1 : 1);
      if (I.pressed('KeyT')) this.setWarp(WARPS[(WARPS.indexOf(this.warp) + 1) % WARPS.length]);
      if (I.pressed('KeyR')) this.active.reset();
      const fwd = I.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
      const turn = I.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
      if (this.active === this.rover) {
        const R = this.rover, O = this.ops;
        const manual = fwd !== 0 || turn !== 0 || I.is('KeyQ', 'KeyE');
        if (manual && this.comms.delayMode) {
          if (!this._delayWarned) { O.log('Режим реальной связи: ручное вождение недоступно — используйте AutoNav', 'warn'); this._delayWarned = true; }
          return;
        }
        this._delayWarned = false;
        if (manual) {
          if (O.busy) { if (!this._busyWarned) { O.log(`Нельзя ехать: идёт «${O.busy}»`, 'warn'); this._busyWarned = true; } return; }
          this._busyWarned = false;
          O.cancelNav('ручное управление');
          if (!O.armStowed()) { O.run('Укладка руки', () => O.stow()); return; }
          if (R.tilt > 30 * PG.DEG && fwd > 0) { R.setDrive(0, 0); return; }
          const v = fwd * PG.ROVER_TOP_SPEED;
          const qe = I.axis(['KeyE'], ['KeyQ']);
          let w;
          if (fwd !== 0) w = turn * PG.ROVER_TOP_SPEED / 2.6 * Math.sign(fwd);   // дуга R ≈ 2.6 м
          else w = (turn || qe) * PG.ROVER_TOP_SPEED / 1.65;                     // разворот на месте
          R.setDrive(v, w);
        } else if (!O.nav) R.setDrive(0, 0);
        if (I.is('Space')) { O.cancelNav(); R.setDrive(0, 0); }
      } else {
        const B = this.buggy;
        B.input.throttle = fwd;
        B.input.steer = turn;
        B.input.brake = I.is('Space');
        B.input.rocket = I.is('ShiftLeft', 'ShiftRight');
      }
    }

    frame(now) {
      requestAnimationFrame((t) => this.frame(t));
      if (this.paused) { this.last = now; return; }     // для автотестов: шагаем вручную
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.t += dt;
      this.controls();
      this.input.endFrame();
      const simDt = this.physics.step(dt * this.warp);
      this.warpEffective = PG.damp(this.warpEffective, dt > 0 ? simDt / dt : 1, 3, dt);
      this.clock.advance(simDt);
      this.clock.sunDir(this.sun);
      this.wx = this.weather.read(this.clock, this.sun);
      this.radState = this.weather.rad(this.wx.pressure, simDt, this.clock);
      this.power.set('Приводы колёс', this.rover.driving ? 150 : this.rover.steering ? 60 : 0);
      this.power.set('Мачта', this.rover.mastBusy() ? 18 : 0);
      this.power.update(simDt, this.wx.air);
      this.passes = this.comms.update(simDt, this.clock, this.power);
      const p = this.rover.group.position;
      this.danPassive = PG.damp(this.danPassive || this.terrain.waterAt(p.x, p.z), this.terrain.waterAt(p.x, p.z), 0.02, simDt);
      this.ops.update();
      this.ops.tickFx();
      this.rover.update(dt, simDt);
      this.buggy.update(dt, simDt, this.t);
      this.dust.update(dt * Math.min(this.warp, 5));
      this.fire.update(dt);
      this.views.update(dt);
      this.env.update(this.sun, this.active.group.position);
      this.hud.update(dt);
      this.views.render(this.t);
    }
  }

  const app = new App();
  PG.app = app;
  app.init().catch((e) => {
    console.error(e);
    const m = document.getElementById('boot-msg');
    m.className = 'err';
    m.textContent = 'Ошибка запуска: ' + e.message;
  });
})(window.PG);
