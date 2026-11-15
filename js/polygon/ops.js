'use strict';
// Операции ровера: последовательности команд в сим-времени (await ops.wait(сек)),
// задержка связи с Землёй, следы работы приборов на камнях и автонавигация.
(function (PG) {
  const S = () => PG.Science;
  const INLETS = {                       // приёмные воронки на палубе (координаты ровера)
    SAM: new THREE.Vector3(-0.32, 1.12, -0.62),
    CheMin: new THREE.Vector3(0.36, 1.1, -0.66),
  };

  PG.Ops = class {
    constructor(app) {
      this.app = app;
      this.waiters = [];
      this.busy = '';
      this.progress = null;        // { label, t, total }
      this.sample = null;          // порошок в CHIMRA
      this.analyses = [];          // идущие анализы SAM/CheMin
      this.pending = [];           // команды «в пути» с Земли
      this.nav = null;
      this.abortFlag = false;
      this.fx = new THREE.Group();
      app.scene.add(this.fx);
      this.beamMat = new THREE.LineBasicMaterial({ color: 0xb98cff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
      this.beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), this.beamMat);
      this.beam.frustumCulled = false; this.beam.visible = false;
      this.spark = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.spark.visible = false;
      this.sparkLight = new THREE.PointLight(0xc7b6ff, 0, 1.5, 2);
      this.fx.add(this.beam, this.spark, this.sparkLight);
      this.pathLine = null;
      this.counter = { chemcam: 0, apxs: 0, mahli: 0, drill: 0, dan: 0, sam: 0, chemin: 0, image: 0 };
    }

    get rover() { return this.app.rover; }
    log(msg, kind = 'info') { this.app.bus.emit('log', { msg, kind, sol: this.app.clock.sol, lmst: this.app.clock.lmst() }); }
    result(data) { this.app.bus.emit('result', data); }

    // ---------- время ----------
    wait(sec) {
      return new Promise((resolve, reject) => this.waiters.push({ t: this.app.clock.elapsed + sec, resolve, reject }));
    }
    until(cond) { return new Promise((resolve, reject) => this.waiters.push({ cond, resolve, reject })); }
    async timed(label, sec, watts, powerName) {
      this.progress = { label, start: this.app.clock.elapsed, total: sec };
      if (watts) this.app.power.set(powerName || label, watts);
      try { await this.wait(sec); } finally { this.progress = null; if (watts) this.app.power.set(powerName || label, 0); }
    }
    update() {
      const now = this.app.clock.elapsed;
      for (const w of this.waiters.slice()) {
        if (this.abortFlag) { w.reject(new Error('прервано оператором')); continue; }
        if ((w.cond && w.cond()) || (w.t !== undefined && now >= w.t)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(); }
      }
      if (this.abortFlag) { this.waiters = []; this.abortFlag = false; }
      for (const p of this.pending.slice()) if (now >= p.at) { this.pending.splice(this.pending.indexOf(p), 1); this.log(`Команда «${p.label}» принята на борту`, 'ok'); p.fn(); }
      for (const a of this.analyses.slice()) if (now >= a.done) { this.analyses.splice(this.analyses.indexOf(a), 1); a.finish(); }
      this.updateNav();
    }
    abort() {
      if (this.busy || this.nav) { this.abortFlag = this.waiters.length > 0; this.cancelNav('остановлено оператором'); }
    }

    // Команда с Земли: в режиме реальной связи приходит через время прохождения сигнала.
    command(label, fn) {
      const C = this.app.comms;
      if (!C.delayMode) { fn(); return; }
      const owlt = C.owlt().seconds;
      this.pending.push({ label, at: this.app.clock.elapsed + owlt, fn });
      this.log(`Команда «${label}» отправлена через DSN, задержка ${PG.fmtDur(owlt)}`, 'warn');
    }

    async run(name, fn) {
      if (this.busy) { this.log(`Занят: ${this.busy}`, 'warn'); return; }
      if (this.app.active !== this.rover) { this.log('Приборы есть только у Curiosity', 'warn'); return; }
      this.busy = name;
      this.app.bus.emit('busy', name);
      try { await fn(); } catch (e) { this.log(`${name}: ${e.message}`, 'err'); }
      finally { this.busy = ''; this.progress = null; this.app.bus.emit('busy', ''); }
    }

    async stopRover() {
      this.cancelNav();
      this.rover.setDrive(0, 0);
      await this.until(() => Math.abs(this.rover.speed) < 0.002);
    }
    needPower(w, what) {
      if (!this.app.power.canRun(w)) throw new Error(`мало заряда батарей для ${what} — подождите зарядки от RTG`);
    }

    // ---------- рука ----------
    async moveArm(q, label) {
      if (typeof q === 'string') throw new Error(q);
      this.rover.setArm(q);
      this.app.power.set('Рука', 60);
      this.progress = { label: label || 'Рука: движение', start: this.app.clock.elapsed, total: 0 };
      await this.until(() => !this.rover.armBusy());
      this.app.power.set('Рука', 0);
      this.progress = null;
    }
    async stow() {
      if (!this.rover.armBusy() && this.rover.arm.target.every((v, i) => Math.abs(v - PG.ARM_POSES.stow[i]) < 1e-3)) return;
      await this.moveArm(PG.ARM_POSES.stow, 'Рука: укладка');
      this.log('Рука уложена', 'ok');
    }
    armStowed() { return this.rover.arm.q.every((v, i) => Math.abs(v - PG.ARM_POSES.stow[i]) < 0.01); }
    async placeArm(hit, standoff, label) {
      await this.stopRover();
      const pre = this.rover.solveArm(hit.point, hit.normal, 0.15);
      if (typeof pre === 'string') throw new Error(pre);
      await this.moveArm(PG.ARM_POSES.ready, 'Рука: выход из укладки');
      await this.moveArm(pre, `${label}: подвод`);
      await this.moveArm(this.rover.solveArm(hit.point, hit.normal, standoff), `${label}: касание`);
    }
    async retract(hit) {
      const pre = this.rover.solveArm(hit.point, hit.normal, 0.15);
      if (typeof pre !== 'string') await this.moveArm(pre, 'Рука: отвод');
    }

    targetInfo(hit) {
      const type = hit.rock ? hit.rock.type : this.app.terrain.materialAt(hit.point.x, hit.point.z);
      const dusty = hit.rock ? hit.rock.dusty : true;
      const name = hit.rock ? PG.ROCK_TYPES[type].name : type === 'mudstone' ? 'Коренной аргиллит' : 'Грунт (реголит)';
      return { type, dusty, name, label: hit.rock ? hit.rock.label || (hit.rock.label = this.rockName()) : 'грунт' };
    }
    rockName() {
      const names = ['Кукушкино', 'Хибины', 'Ловозеро', 'Онега', 'Тиман', 'Пинега', 'Мезень', 'Вычегда', 'Сысола', 'Кандалакша', 'Умба', 'Варзуга', 'Терек', 'Юган', 'Пур', 'Таз', 'Надым', 'Сосьва', 'Ляпин', 'Щучья'];
      this.nameIdx = (this.nameIdx || 0) + 1;
      return names[(this.nameIdx - 1) % names.length] + (this.nameIdx > names.length ? ` ${Math.ceil(this.nameIdx / names.length)}` : '');
    }

    decal(hit, radius, color, opacity, lift = 0.003) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), new THREE.MeshStandardMaterial({
        color, transparent: true, opacity, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false,
      }));
      m.position.copy(hit.point).addScaledVector(hit.normal, lift);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
      m.renderOrder = 3;
      this.fx.add(m);
      return m;
    }

    // ---------- ChemCam: лазер LIBS + RMI ----------
    chemcam(hit) {
      this.command('ChemCam LIBS', () => this.run('ChemCam', async () => {
        const R = this.rover;
        const head = R.mastRay(new THREE.Ray()).origin;
        const dist = head.distanceTo(hit.point);
        if (dist > 7) throw new Error(`цель в ${dist.toFixed(1)} м — ChemCam работает до 7 м`);
        this.needPower(70, 'ChemCam');
        await this.stopRover();
        const info = this.targetInfo(hit);
        this.log(`ChemCam: наведение на «${info.label}» (${dist.toFixed(2)} м)`);
        R.aimMastAt(hit.point);
        this.app.power.set('ChemCam', 70);
        try {
          await this.until(() => !R.mastBusy());
          this.app.views.focusInstrument('chemcam');
          await this.timed('Автофокус телескопа', 6);
          const shots = 30, raster = 5;
          for (let p = 0; p < raster; p++) {
            const pt = hit.point.clone().add(new THREE.Vector3((p - 2) * 0.004, 0, 0).applyQuaternion(R.group.quaternion));
            for (let s = 0; s < shots; s++) {
              this.progress = { label: `LIBS: точка ${p + 1}/${raster}, импульс ${s + 1}/${shots}`, start: 0, total: 0 };
              this.flashLaser(R.mastRay(new THREE.Ray()).origin, pt);
              await this.wait(1 / 3);         // лазер 3 Гц
            }
            this.decal({ point: pt, normal: hit.normal }, 0.0025, 0x231a16, 0.9, 0.002);
          }
          this.beam.visible = false; this.spark.visible = false; this.sparkLight.intensity = 0;
          if (hit.rock) hit.rock.dusty = false;
          const ox = S().composition(info.type, hit.point, false);
          const spec = S().libs(ox, shots, hit.point);
          const rmi = this.app.views.capture('chemcam', 512, 512);
          this.app.comms.add(5 + 4);
          this.counter.chemcam++;
          this.result({ kind: 'chemcam', title: `ChemCam LIBS · «${info.label}»`, target: info, ox, spec, image: rmi, dist, shots: shots * raster });
          this.log(`ChemCam: ${shots * raster} импульсов, спектр и снимок RMI получены`, 'ok');
        } finally { this.app.power.set('ChemCam', 0); }
      }));
    }
    flashLaser(from, to) {
      const pos = this.beam.geometry.attributes.position;
      pos.setXYZ(0, from.x, from.y, from.z); pos.setXYZ(1, to.x, to.y, to.z); pos.needsUpdate = true;
      this.beam.visible = true; this.spark.visible = true;
      this.spark.position.copy(to);
      this.spark.scale.setScalar(0.6 + Math.random());
      this.sparkLight.position.copy(to); this.sparkLight.intensity = 3;
      this.flashUntil = performance.now() + 60;
    }
    tickFx() {
      if (this.flashUntil && performance.now() > this.flashUntil) {
        this.beam.visible = false; this.spark.visible = false; this.sparkLight.intensity = 0; this.flashUntil = 0;
      }
    }

    // ---------- инструменты на руке ----------
    mahli(hit) {
      this.command('MAHLI', () => this.run('MAHLI', async () => {
        const info = this.targetInfo(hit);
        await this.placeArm(hit, 0.025, 'MAHLI');
        this.app.views.focusInstrument('mahli');
        this.app.power.set('MAHLI', 8);
        await this.timed('MAHLI: стек фокусировки (8 кадров), подсветка LED', 90);
        const img = this.app.views.capture('mahli', 640, 480);
        this.app.power.set('MAHLI', 0);
        this.app.comms.add(15);
        this.counter.mahli++;
        this.result({ kind: 'image', title: `MAHLI · «${info.label}» · 2.5 см, ~16 мкм/пикс`, image: img, note: `${info.name}${info.dusty ? ', покрыт пылью' : ', поверхность очищена'}` });
        this.log('MAHLI: снимок крупным планом готов', 'ok');
        await this.retract(hit);
      }));
    }
    apxs(hit) {
      this.command('APXS', () => this.run('APXS', async () => {
        const info = this.targetInfo(hit);
        await this.placeArm(hit, 0.01, 'APXS');
        this.app.views.focusInstrument('fhaz');
        const sec = 20 * 60;
        await this.timed('APXS: накопление спектра (кюрий-244)', sec, 4, 'APXS');
        const ox = S().composition(info.type, hit.point, info.dusty);
        this.result({ kind: 'apxs', title: `APXS · «${info.label}» · ${sec / 60} мин`, target: info, ox, spec: S().apxs(ox, sec, hit.point) });
        this.app.comms.add(0.3);
        this.counter.apxs++;
        this.log(`APXS: состав «${info.label}» получен${info.dusty ? ' (с пылью — почистите щёткой DRT)' : ''}`, 'ok');
        await this.retract(hit);
      }));
    }
    drt(hit) {
      this.command('DRT', () => this.run('DRT', async () => {
        if (!hit.rock) throw new Error('щёткой DRT чистят камни, а не рыхлый грунт');
        const info = this.targetInfo(hit);
        await this.placeArm(hit, 0.005, 'DRT');
        this.app.views.focusInstrument('fhaz');
        await this.timed('DRT: вращение щётки', 120, 12, 'DRT');
        hit.rock.dusty = false;
        this.decal(hit, 0.024, 0x6d6460, 0.85);
        this.log(`DRT: пятно 4.5 см на «${info.label}» очищено от пыли`, 'ok');
        await this.retract(hit);
      }));
    }
    drill(hit) {
      this.command('Бур', () => this.run('Бурение', async () => {
        if (!hit.rock && this.app.terrain.materialAt(hit.point.x, hit.point.z) !== 'mudstone') throw new Error('бурят коренную породу или камни — грунт возьмите совком CHIMRA');
        if (this.sample) throw new Error('в CHIMRA уже есть образец — отправьте его в SAM или CheMin');
        this.needPower(150, 'бура');
        const info = this.targetInfo(hit);
        await this.placeArm(hit, 0.0, 'Бур');
        this.app.views.focusInstrument('fhaz');
        await this.timed('Бур: предварительное нагружение', 60);
        await this.timed('Бур: ударно-вращательное бурение до 5 см', 25 * 60, 150, 'Бур');
        this.decal(hit, 0.05, 0x8c837d, 0.85, 0.002);
        this.decal(hit, 0.008, 0x0a0706, 1, 0.004);
        await this.timed('CHIMRA: просеивание < 150 мкм', 5 * 60, 20, 'CHIMRA');
        this.sample = { ...info, pos: hit.point.clone(), id: ++this.counter.drill, portions: { SAM: true, CheMin: true } };
        this.app.bus.emit('sample', this.sample);
        this.log(`Бур: образец №${this.sample.id} «${info.label}» в CHIMRA. Отправьте в SAM или CheMin`, 'ok');
        await this.retract(hit);
        await this.stow();
      }));
    }
    deliver(to) {
      this.command(`Доставка в ${to}`, () => this.run(`Доставка в ${to}`, async () => {
        if (!this.sample) throw new Error('нет образца — сначала пробурите камень');
        if (!this.sample.portions[to]) throw new Error(`порция для ${to} уже отдана — для повтора нужен новый образец`);
        if (this.analyses.some((a) => a.to === to)) throw new Error(`${to} ещё занят анализом`);
        await this.stopRover();
        const R = this.rover, inlet = INLETS[to].clone().applyMatrix4(R.group.matrixWorld);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(R.group.quaternion);
        await this.moveArm(PG.ARM_POSES.ready, 'Рука: выход из укладки');
        const q = R.solveArm(inlet, up, 0.08);
        await this.moveArm(typeof q === 'string' ? PG.ARM_POSES.ready : q, `Рука: над воронкой ${to}`);
        await this.timed(`CHIMRA: порция порошка в ${to}`, 60);
        const s = this.sample;
        s.portions[to] = false;
        if (!s.portions.SAM && !s.portions.CheMin) this.sample = null;   // порошок кончился
        this.app.bus.emit('sample', this.sample);
        await this.stow();
        const dur = to === 'SAM' ? 50 * 60 : 40 * 60;
        const watts = to === 'SAM' ? 420 : 40;
        this.app.power.set(to, watts);
        this.log(`${to}: анализ образца №${s.id} начат (≈${dur / 60} мин)`, 'info');
        this.analyses.push({
          to, started: this.app.clock.elapsed, done: this.app.clock.elapsed + dur, finish: () => {
            this.app.power.set(to, 0);
            if (to === 'SAM') this.result({ kind: 'sam', title: `SAM · образец №${s.id} «${s.label}»`, target: s, data: S().sam(s.type, s.pos) });
            else this.result({ kind: 'chemin', title: `CheMin · образец №${s.id} «${s.label}»`, target: s, data: S().chemin(s.type, s.pos) });
            this.app.comms.add(to === 'SAM' ? 10 : 4);
            this.counter[to.toLowerCase()]++;
            this.log(`${to}: результаты образца №${s.id} готовы`, 'ok');
          },
        });
      }));
    }

    // ---------- DAN: активное нейтронное зондирование ----------
    dan() {
      this.command('DAN активный', () => this.run('DAN', async () => {
        await this.stopRover();
        const p = this.rover.group.position;
        await this.timed('DAN: импульсы генератора нейтронов 14 МэВ', 15 * 60, 20, 'DAN');
        const R = PG.rng(Math.floor(p.x * 31 + p.z * 17) >>> 0);
        const weh = this.app.terrain.waterAt(p.x, p.z) + (R() - 0.5) * 0.4;
        const cl = 0.6 + R() * 0.6;
        const t = [], th = [], ep = [];
        for (let i = 0; i < 64; i++) {
          const us = 10 + i * 30; t.push(us);
          th.push(Math.exp(-us / (420 - weh * 35)) * (1 + weh / 4) * 1000 + R() * 15);
          ep.push(Math.exp(-us / 160) * 800 / (1 + weh / 6) + R() * 10);
        }
        this.counter.dan++;
        this.app.comms.add(0.5);
        this.result({ kind: 'dan', title: `DAN · сол ${this.app.clock.sol} · точка ${p.x.toFixed(0)}, ${p.z.toFixed(0)}`, weh, cl, t, th, ep });
        this.log(`DAN: водородный эквивалент ${weh.toFixed(1)} % масс. в верхних 50 см`, 'ok');
      }));
    }

    // ---------- Mastcam: панорама ----------
    panorama() {
      this.command('Панорама Mastcam', () => this.run('Панорама', async () => {
        await this.stopRover();
        const R = this.rover;
        this.app.views.focusInstrument('mastcam34');
        this.app.power.set('Mastcam', 15);
        const frames = 12;
        for (let i = 0; i < frames; i++) {
          R.setMast(-Math.PI + (i + 0.5) * (2 * Math.PI / frames), -0.12);
          this.progress = { label: `Mastcam M-34: кадр ${i + 1}/${frames}`, start: 0, total: 0 };
          await this.until(() => !R.mastBusy());
          await this.wait(4);
        }
        R.setMast(0, -0.12);
        this.app.power.set('Mastcam', 0);
        this.app.comms.add(frames * 20);
        this.counter.image += frames;
        this.log(`Mastcam: панорама 360° из ${frames} кадров записана (${frames * 20} Мбит)`, 'ok');
      }));
    }

    // ---------- селфи MAHLI ----------
    selfie() {
      this.command('Селфи MAHLI', () => this.run('Селфи', async () => {
        await this.stopRover();
        const R = this.rover;
        await this.moveArm(PG.ARM_POSES.ready, 'Рука: выход из укладки');
        await this.moveArm(PG.ARM_POSES.selfie, 'Рука: поза для селфи');
        R.setMast(0.55, 0.05);
        await this.until(() => !R.mastBusy());
        await this.timed('MAHLI: 57 кадров мозаики', 120, 8, 'MAHLI');
        const img = this.app.views.captureSelfie(1600, 1000);
        this.app.comms.add(60);
        this.result({ kind: 'image', title: `Селфи Curiosity · сол ${this.app.clock.sol}`, image: img, note: 'Мозаика MAHLI: рука на кадрах не видна, её «вырезают» при склейке', download: `curiosity-selfie-sol${this.app.clock.sol}.jpg` });
        this.log('Селфи готово — рука «исчезла», как на настоящих мозаиках', 'ok');
        R.setMast(0, -0.12);
        await this.stow();
      }));
    }

    // ---------- автонавигация ----------
    navigate(goal) {
      this.command('AutoNav', async () => {
        if (this.busy) { this.log(`AutoNav: занят (${this.busy})`, 'warn'); return; }
        if (!this.armStowed()) await this.stow();
        const path = this.plan(this.rover.group.position, goal);
        if (!path) { this.log('AutoNav: путь к цели не найден — слишком крутые склоны или камни', 'err'); return; }
        this.nav = { path, i: 1, goal, sinceStop: 0, lastPos: this.rover.group.position.clone(), think: 0, slipNote: 0 };
        this.drawPath(path);
        const len = path.reduce((s, p, i) => (i ? s + p.distanceTo(path[i - 1]) : 0), 0);
        this.log(`AutoNav: маршрут ${len.toFixed(1)} м, ${path.length} точек; ≈${PG.fmtDur((len / PG.ROVER_TOP_SPEED + (len / 1.5) * 25) * 1.3)} с остановками на анализ`, 'info');
      });
    }
    cancelNav(reason) {
      if (!this.nav) return;
      this.nav = null;
      this.rover.setDrive(0, 0);
      if (this.pathLine) { this.fx.remove(this.pathLine); this.pathLine = null; }
      if (reason) this.log(`AutoNav: ${reason}`, 'warn');
    }
    updateNav() {
      const N = this.nav; if (!N) return;
      const R = this.rover, p = R.group.position;
      if (R.tilt > 30 * PG.DEG) { this.cancelNav('наклон больше 30° — защита от опрокидывания'); return; }
      if (N.think > 0) {
        R.setDrive(0, 0);
        if (this.app.clock.elapsed >= N.think) {
          N.think = 0;
          this.progress = null;
          if (R.slip > 0.4 && N.slipNote < 3) { N.slipNote++; this.log(`Визуальная одометрия: пробуксовка ${(R.slip * 100).toFixed(0)} %`, 'warn'); }
          if (R.slip > 0.6) { this.cancelNav('пробуксовка больше 60 % — остановка (slip check)'); return; }
        }
        return;
      }
      const wp = N.path[N.i];
      const dx = wp.x - p.x, dz = wp.z - p.z, d = Math.hypot(dx, dz);
      if (d < (N.i === N.path.length - 1 ? 0.5 : 0.8)) {
        N.i++;
        if (N.i >= N.path.length) { this.cancelNav(); this.log('AutoNav: цель достигнута', 'ok'); return; }
        return;
      }
      const want = Math.atan2(-dx, -dz);
      const err = PG.wrapAngle(want - R.heading());
      if (Math.abs(err) > 0.35) R.setDrive(0, Math.sign(err) * PG.ROVER_TOP_SPEED / 1.6);
      else R.setDrive(PG.ROVER_TOP_SPEED, PG.clamp(err * 0.08, -0.02, 0.02));
      N.sinceStop += Math.hypot(p.x - N.lastPos.x, p.z - N.lastPos.z);
      N.lastPos.copy(p);
      // стоп каждые ~1.5 м: стереоснимки Navcam, карта опасностей, визуальная одометрия
      if (N.sinceStop > 1.5) {
        N.sinceStop = 0;
        N.think = this.app.clock.elapsed + 25;
        this.progress = { label: 'AutoNav: стереопара Navcam → карта опасностей', start: this.app.clock.elapsed, total: 25 };
        this.app.comms.add(2);
      }
    }
    // A* по сетке 0.5 м с запретом крутых склонов и камней (с запасом на габарит ровера)
    plan(from, to) {
      const T = this.app.terrain, cell = 0.5, margin = 10;
      const minX = Math.min(from.x, to.x) - margin, minZ = Math.min(from.z, to.z) - margin;
      const w = Math.ceil((Math.abs(to.x - from.x) + 2 * margin) / cell), h = Math.ceil((Math.abs(to.z - from.z) + 2 * margin) / cell);
      if (w * h > 260 * 260) { this.log('AutoNav: цель дальше ~110 м — поставьте промежуточную точку', 'warn'); return null; }
      const cost = new Float32Array(w * h), nrm = new THREE.Vector3();
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const x = minX + i * cell, z = minZ + j * cell;
        T.normalAt(x, z, nrm);
        const slope = Math.acos(nrm.y);
        cost[j * w + i] = slope > 20 * PG.DEG ? Infinity : 1 + slope * 6;
      }
      for (const r of T.rocks) {
        if (r.radius < 0.22) continue;
        const rad = r.radius + 1.4;
        const i0 = Math.floor((r.x - rad - minX) / cell), i1 = Math.ceil((r.x + rad - minX) / cell);
        const j0 = Math.floor((r.z - rad - minZ) / cell), j1 = Math.ceil((r.z + rad - minZ) / cell);
        for (let j = Math.max(0, j0); j <= Math.min(h - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(w - 1, i1); i++) {
          const d = Math.hypot(minX + i * cell - r.x, minZ + j * cell - r.z);
          if (d < rad) cost[j * w + i] = d < r.radius + 1.0 ? Infinity : cost[j * w + i] + 6;
        }
      }
      const idx = (x, z) => PG.clamp(Math.round((z - minZ) / cell), 0, h - 1) * w + PG.clamp(Math.round((x - minX) / cell), 0, w - 1);
      const start = idx(from.x, from.z), goal = idx(to.x, to.z);
      cost[start] = 1;
      if (!isFinite(cost[goal])) { this.log('AutoNav: цель на опасном участке — выберите точку рядом', 'warn'); return null; }
      const g = new Float32Array(w * h).fill(Infinity), came = new Int32Array(w * h).fill(-1), closed = new Uint8Array(w * h);
      const heap = [];
      const push = (n, f) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top[1]; };
      const gx = goal % w, gz = Math.floor(goal / w);
      const hfn = (n) => Math.hypot((n % w) - gx, Math.floor(n / w) - gz);
      g[start] = 0; push(start, hfn(start));
      const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
      let found = false, iter = 0;
      while (heap.length && iter++ < 400000) {
        const n = pop();
        if (closed[n]) continue;
        if (n === goal) { found = true; break; }
        closed[n] = 1;
        const x = n % w, z = Math.floor(n / w);
        for (const [dx, dz, dd] of D) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
          const m = nz * w + nx;
          if (closed[m] || !isFinite(cost[m])) continue;
          const ng = g[n] + dd * (cost[m] + cost[n]) / 2;
          if (ng < g[m]) { g[m] = ng; came[m] = n; push(m, ng + hfn(m)); }
        }
      }
      if (!found) return null;
      const cells = [];
      for (let n = goal; n !== -1; n = came[n]) cells.push(n);
      cells.reverse();
      const pts = cells.map((n) => new THREE.Vector3(minX + (n % w) * cell, 0, minZ + Math.floor(n / w) * cell));
      // упрощение: оставляем точки примерно через 2 м и на поворотах
      const out = [from.clone()];
      for (let i = 1; i < pts.length - 1; i++) {
        const last = out[out.length - 1];
        if (pts[i].distanceTo(last) > 2.5) out.push(pts[i]);
      }
      out.push(new THREE.Vector3(to.x, 0, to.z));
      out.forEach((p) => { p.y = T.heightAt(p.x, p.z); });
      return out;
    }
    drawPath(path) {
      if (this.pathLine) this.fx.remove(this.pathLine);
      const T = this.app.terrain, pts = [];
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], n = Math.ceil(a.distanceTo(b) / 0.5);
        for (let k = 0; k <= n; k++) {
          const p = a.clone().lerp(b, k / n); p.y = T.heightAt(p.x, p.z) + 0.06; pts.push(p);
        }
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      this.pathLine = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0x4fe3ff, dashSize: 0.4, gapSize: 0.25, transparent: true, opacity: 0.9, depthTest: false }));
      this.pathLine.computeLineDistances();
      this.pathLine.renderOrder = 5;
      this.fx.add(this.pathLine);
    }
  };
})(window.PG);
