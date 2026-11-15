'use strict';
// Phase 3: walk the planned route in first person. Suit model: O2 from metabolic rate, heart rate from
// workload, dose from the radiation layer; a solar particle event forces a dash to shelter.
(function (PG) {
  const EYE = 1.62;                 // m, eye height inside the helmet
  const O2_KG = 1.2;                // usable O2 at start of EVA
  const SUIT_KPA = 29.6;            // 4.3 psi, xEMU operating pressure
  const SEP_AT = 0.45;              // fraction of the route where the space-weather alert fires
  const SEP_SHELTER_SVF = 0.62;     // a spot this enclosed cuts the GCR/SEP dose markedly

  PG.Walker = class {
    constructor(app) {
      this.app = app;
      this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 9000);
      this.yaw = 0; this.pitch = -0.08;
      this.pos = new THREE.Vector3();
      this.active = false;
      this.follow = true;
      this.warp = 1;
      addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); });
      const el = app.renderer.domElement;
      el.addEventListener('click', () => { if (this.active && document.pointerLockElement !== el) el.requestPointerLock?.(); });
      addEventListener('mousemove', (e) => {
        if (!this.active || document.pointerLockElement !== el) return;
        this.yaw -= e.movementX * 0.0022;
        this.pitch = PG.clamp(this.pitch - e.movementY * 0.0022, -1.2, 1.2);
        this.follow = false;
      });
    }

    start(route, evalResult) {
      this.route = route;
      this.ev = evalResult;
      this.samples = evalResult.samples;
      const p = this.samples[0];
      this.pos.set(p.x, this.app.terrain.heightAt(p.x, p.z) + EYE, p.z);
      const q = this.samples[Math.min(4, this.samples.length - 1)];
      this.yaw = Math.atan2(-(q.x - p.x), -(q.z - p.z));
      this.active = true;
      this.follow = true;
      this.t = 0; this.dist = 0; this.o2 = O2_KG; this.dose = 0; this.hr = 82; this.energy = 0;
      this.progress = 0; this.sepFired = false; this.shelter = null; this.sheltered = 0;
      this.stopsDone = new Set();
      this.buildRibbon();
    }

    stop() {
      this.active = false;
      if (document.pointerLockElement) document.exitPointerLock();
      if (this.ribbon) { this.app.scene.remove(this.ribbon); this.ribbon.geometry.dispose(); this.ribbon = null; }
      if (this.shelterMark) { this.app.scene.remove(this.shelterMark); this.shelterMark = null; }
    }

    // glowing strip on the ground along the route, coloured by rating
    buildRibbon() {
      const S = this.samples, T = this.app.terrain, pos = [], col = [], idx = [];
      const c = new THREE.Color();
      for (let i = 0; i < S.length; i++) {
        const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)];
        let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        const w = 0.35;
        for (const s of [-1, 1]) {
          const x = S[i].x - dz * w * s, z = S[i].z + dx * w * s;
          pos.push(x, T.heightAt(x, z) + 0.05, z);
          c.set(PG.LEVEL[S[i].r.lvl].color);
          col.push(c.r, c.g, c.b);
        }
        if (i) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      this.ribbon = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
      this.ribbon.renderOrder = 2;
      this.app.scene.add(this.ribbon);
    }

    nearestIndex() {
      const S = this.samples;
      let best = Infinity, bi = this.progress;
      const lo = Math.max(0, this.progress - (this.backtrackRange || 15)), hi = Math.min(S.length - 1, this.progress + 40);
      for (let i = lo; i <= hi; i++) {
        const d = Math.hypot(S[i].x - this.pos.x, S[i].z - this.pos.z);
        if (d < best) { best = d; bi = i; }
      }
      return { i: bi, off: best };
    }

    update(dt, input) {
      const A = this.app, T = A.terrain;
      const sim = dt * this.warp;
      // input → desired direction
      const stopped = input.is('Space');
      const fwd = stopped ? 0 : input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
      const side = stopped ? 0 : input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
      if (input.pressed('KeyF')) this.follow = !this.follow;
      if (input.pressed('KeyT')) this.warp = this.warp === 1 ? 5 : this.warp === 5 ? 20 : 1;
      const near = this.nearestIndex();
      this.progress = Math.max(this.progress, near.i);
      const S = this.samples;
      const look = S[Math.min(S.length - 1, near.i + 3)];
      if (this.follow) {
        const want = Math.atan2(-(look.x - this.pos.x), -(look.z - this.pos.z));
        this.yaw += PG.wrapAngle(want - this.yaw) * (1 - Math.exp(-dt * 3));
        this.pitch += (-0.12 - this.pitch) * (1 - Math.exp(-dt * 2));
      }
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      let mx = fx * fwd + -fz * side * 0.6, mz = fz * fwd + fx * side * 0.6;
      const ml = Math.hypot(mx, mz);
      let speed = 0, grade = 0;
      const here = A.env.sample(this.pos.x, this.pos.z, A.clock, A.sun, A.wx);
      if (ml > 0.01) {
        mx /= ml; mz /= ml;
        const ahead = T.heightAt(this.pos.x + mx, this.pos.z + mz) - T.heightAt(this.pos.x, this.pos.z);
        grade = ahead;
        speed = PG.walkSpeed(grade) / (1 + 0.5 * here.sand + 2.5 * Math.max(0, here.rough - 0.03));
        if (here.slope > PG.EVA_LIMITS.slopeNoGo && grade > 0) speed *= 0.15;     // can't climb that
        const step = speed * sim;
        this.pos.x += mx * step; this.pos.z += mz * step;
        this.pos.x = PG.clamp(this.pos.x, -T.half + 2, T.half - 2);
        this.pos.z = PG.clamp(this.pos.z, -T.half + 2, T.half - 2);
        this.dist += step;
      }
      // Mars-gravity gait: slow, long bob
      this.t += sim;
      const bob = speed > 0.05 ? Math.sin(this.dist * 2.4) * 0.035 : 0;
      const gy = T.heightAt(this.pos.x, this.pos.z) + EYE + bob;
      this.pos.y += (gy - this.pos.y) * (1 - Math.exp(-dt * 12));
      // physiology and consumables
      const W = PG.metabolicW(grade, speed);
      this.energy += W * sim;
      this.o2 = Math.max(0, O2_KG - this.energy / 1000 / 20.1 * 1.429 / 1000);
      const hrTarget = 70 + (W - 120) * 0.22;
      this.hr += (hrTarget - this.hr) * (1 - Math.exp(-sim / 20));
      this.dose += here.dose * sim / 3600;
      this.here = here;
      this.rating = A.env.rate(here);
      this.offRoute = near.off;
      // space weather: once, part-way along the route
      if (!this.sepFired && this.progress > S.length * SEP_AT) this.fireSEP();
      if (this.shelter) {
        const d = Math.hypot(this.shelter.x - this.pos.x, this.shelter.z - this.pos.z);
        this.shelter.dist = d;
        if (d < 4) this.sheltered += sim;
        if (this.sheltered > 40 || A.env.sep <= 0) { this.shelter.done = true; }
      }
      // science stops on the way
      for (const cp of A.checkpoints) {
        if (this.stopsDone.has(cp.id)) continue;
        if (Math.hypot(cp.x - this.pos.x, cp.z - this.pos.z) < 5) { this.stopsDone.add(cp.id); A.toast(`Science stop: ${cp.name}`, 'ok'); }
      }
      // camera
      this.camera.position.copy(this.pos);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      this.camera.updateMatrixWorld();
      return this.progress >= S.length - 2 && near.off < 6;
    }

    // Find the most enclosed spot (lowest sky-view) within 120 m: overhangs and the foot of ridges.
    fireSEP() {
      this.sepFired = true;
      const A = this.app, T = A.terrain;
      A.env.triggerSEP(PG.SOL * 0.04);
      let best = null;
      for (let r = 6; r <= 120; r += 3) for (let a = 0; a < Math.PI * 2; a += 0.2) {
        const x = this.pos.x + Math.cos(a) * r, z = this.pos.z + Math.sin(a) * r;
        if (!T.inside(x, z, 4) || T.slopeAt(x, z) > PG.EVA_LIMITS.slopePoor) continue;
        const svf = T.svfAt(x, z);
        const score = svf + r / 900;
        if (!best || score < best.score) best = { x, z, svf, score };
      }
      if (best) {
        this.shelter = best;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 60, 12, 1, true),
          new THREE.MeshBasicMaterial({ color: 0x4fe3ff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        m.position.set(best.x, T.heightAt(best.x, best.z) + 30, best.z);
        A.scene.add(m);
        this.shelterMark = m;
      }
      A.walkAlert(best);
    }
  };
})(window.PG);
