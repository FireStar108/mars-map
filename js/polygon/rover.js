'use strict';
// Curiosity: 6 ведущих колёс, 4 поворотных (разворот на месте), рокер-боги, мачта RSM и рука-манипулятор.
// Физика — лучевые колёса; рокеры и боги в модели поворачиваются по ходам подвесок (наименьшие квадраты).
(function (PG) {
  const ORDER = ['FL', 'FR', 'ML', 'MR', 'BL', 'BR'];
  const STEERABLE = { FL: 1, FR: 1, BL: 1, BR: 1 };
  const STEER_RATE = 15 * PG.DEG;      // скорость приводов поворота колёс, рад/с
  const STEER_LIMIT = 100 * PG.DEG;
  const MAST_RATE = 12 * PG.DEG;
  const ARM_RATE = 5 * PG.DEG;
  const WHEEL_R = 0.25;

  // Позы руки: [азимут, плечо, локоть, запястье] — смещения от позы в модели.
  const ARM_POSES = {
    stow:  [-1.38, 0.12, 1.5, 1.1],
    ready: [0.0, 0.35, 0.5, 0.6],
    selfie: [0.95, 0.62, -0.55, 0.0],
  };
  PG.ARM_POSES = ARM_POSES;

  PG.Rover = class {
    constructor(ctx, gltf, spawn) {
      this.ctx = ctx;
      this.kind = 'rover';
      this.name = 'Curiosity';
      this.group = new THREE.Group();
      this.model = gltf.scene;
      this.group.add(this.model);
      ctx.scene.add(this.group);
      const N = (n) => {
        const o = this.model.getObjectByName(n);
        if (!o) throw new Error(`в модели нет узла ${n}`);
        return o;
      };
      this.model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        const m = o.material;
        // без карты окружения металл чернеет — приглушаем
        m.metalness = Math.min(m.metalness, 0.25);
        m.roughness = Math.max(m.roughness, 0.45);
      });
      this.model.updateMatrixWorld(true);
      this.nodes = {
        rocker: { L: N('rockerL'), R: N('rockerR') }, bogie: { L: N('bogieL'), R: N('bogieR') },
        steer: {}, wheel: {},
        mastPan: N('mastPan'), mastHead: N('mastHead'),
        armBase: N('armBase'), armUpper: N('armUpper'), armFore: N('armFore'), armTurret: N('armTurret'),
      };
      for (const k of ORDER) {
        this.nodes.wheel[k] = N('wheel' + k);
        if (STEERABLE[k]) this.nodes.steer[k] = N('steer' + k);
      }
      const wp = (o) => o.getWorldPosition(new THREE.Vector3());
      this.restWheel = {};
      for (const k of ORDER) this.restWheel[k] = wp(this.nodes.wheel[k]);
      this.pivot = {
        rocker: wp(this.nodes.rocker.L), bogie: wp(this.nodes.bogie.L),
      };
      // кинематика руки в координатах ровера
      this.arm = {
        B: wp(this.nodes.armBase), S: wp(this.nodes.armUpper), E: wp(this.nodes.armFore), W: wp(this.nodes.armTurret),
        q: ARM_POSES.stow.slice(), target: ARM_POSES.stow.slice(), L3: 0.36,
      };
      const A = this.arm;
      const fwd = (p) => -(p.z - A.B.z);
      A.S2 = new THREE.Vector2(fwd(A.S), A.S.y); A.E2 = new THREE.Vector2(fwd(A.E), A.E.y); A.W2 = new THREE.Vector2(fwd(A.W), A.W.y);
      A.L1 = A.E2.distanceTo(A.S2); A.L2 = A.W2.distanceTo(A.E2);
      A.a0 = Math.atan2(A.E2.y - A.S2.y, A.E2.x - A.S2.x);
      A.b0 = Math.atan2(A.W2.y - A.E2.y, A.W2.x - A.E2.x);
      this.applyArm();

      this.mast = { pan: 0, tilt: -0.12, tPan: 0, tTilt: -0.12 };
      this.cmd = { v: 0, w: 0 };
      this.stopReason = '';
      this.odometer = 0;
      this.slip = 0;
      this.tilt = 0;
      this.driving = false;
      this.steering = false;

      const restY = this.restWheel.FL.y;
      const stiffness = 26, sag = PG.G_MARS / (6 * stiffness);
      const wheels = ORDER.map((k) => ({
        key: k, pos: this.restWheel[k].clone(), radius: WHEEL_R, rest: 0.24, sag, stiffness,
        compression: 4.0, relaxation: 4.6, friction: 1.0, sideStiffness: 1.2, travel: 0.2, maxForce: 1e5,
        steerable: !!STEERABLE[k], integ: 0,
      }));
      const y0 = ctx.terrain.heightAt(spawn.x, spawn.z) + 0.05;
      this.vehicle = new PG.WheeledVehicle(ctx.physics, {
        kind: 'rover', position: { x: spawn.x, y: y0, z: spawn.z }, yaw: spawn.yaw || 0,
        chassis: [
          { half: [0.62, 0.28, 0.92], offset: [0, 0.92, 0.05], mass: 700 },
          { half: [0.4, 0.3, 0.3], offset: [0, 1.05, 1.15], mass: 0 },      // RTG
        ],
        centerOfMass: { offset: [0, 0.4, 0], mass: 199 },
        angularDamping: 1.2, linearDamping: 0.05,
        wheels,
      });
      this.vehicle.control = (dt) => this.control(dt);
      this.vehicle.onReset = () => { this.hold = null; };
      this.restY = restY;
      this.equilibrium = 0.24 - sag;

      // следы: каждая пара колёс по своей колее
      this.trails = ORDER.map(() => ctx.tracks.trail('curiosity', 0.4, 2 * Math.PI * WHEEL_R));
      this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._q = new THREE.Quaternion();
      this.gripNormal = new THREE.Vector3();
      this.contactNormal = new THREE.Vector3();
      this.contactPosition = new THREE.Vector3();
      this.sideDirection = new THREE.Vector3();
      this.ctl = { iv: 0, iw: 0 };
      this.inertiaY = 899 * (2.8 * 2.8 + 3.0 * 3.0) / 12;   // момент инерции рысканья, кг·м²
      this.lastPos = this.vehicle.position(new THREE.Vector3());
      this.slipAcc = { body: 0, wheel: 0 };
      this.lastRot = ORDER.map(() => 0);
    }

    // ---------- вождение ----------
    // v — скорость вперёд (м/с), w — скорость поворота (рад/с, + влево)
    setDrive(v, w) { this.cmd.v = v; this.cmd.w = w; }

    control(dt) {
      const V = this.vehicle, q = V.quaternion(this._q);
      let { v, w } = this.cmd;
      const idle = Math.abs(v) < 1e-5 && Math.abs(w) < 1e-6;
      // наклон корпуса — защита от опрокидывания
      const up = this._v1.set(0, 1, 0).applyQuaternion(q);
      this.tilt = Math.acos(PG.clamp(up.y, -1, 1));
      // 1) целевые углы и скорости колёс из «твиста» корпуса
      let maxErr = 0;
      for (const wh of V.wheels) {
        const x = wh.pos.x, z = wh.pos.z;
        const vx = w * z, vz = -v - w * x;
        const sp = Math.hypot(vx, vz);
        let phi = wh.steerable ? wh.steer : 0, u = 0;
        if (sp > 1e-7) {
          if (wh.steerable) {
            phi = Math.atan2(-vx, -vz);    // качение колеса при руле φ: (−sin φ, 0, −cos φ)
            u = sp;
            if (Math.abs(phi) > Math.PI / 2) { phi -= Math.sign(phi) * Math.PI; u = -sp; }
            phi = PG.clamp(phi, -STEER_LIMIT, STEER_LIMIT);
          } else u = -vz;
        } else if (wh.steerable && !idle) phi = wh.steer;
        wh.targetSteer = wh.steerable ? phi : 0;
        wh.targetU = u;
        if (wh.steerable) maxErr = Math.max(maxErr, Math.abs(wh.targetSteer - wh.steer));
      }
      // 2) колёса поворачиваются, пока стоим (как настоящий ровер)
      this.steering = maxErr > 0.03;
      for (const wh of V.wheels) {
        if (wh.steerable) wh.steer = PG.approach(wh.steer, wh.targetSteer, STEER_RATE * dt);
      }
      // 3) регулятор корпуса: продольная скорость и скорость рысканья → сила и момент,
      //    которые распределяются по колёсам (наименьшая норма). Покалёсные регуляторы
      //    в развороте мешали друг другу через корпус.
      this.driving = false;
      const body = V.body;
      body.resetForces(true); body.resetTorques(true);
      // Low-speed traction assist supplies the slope load that a real wheel motor
      // must resist. Apply only while supported, and stay within a friction budget.
      const normal = this.gripNormal.set(0, 0, 0);
      let contacts = 0;
      for (const wh of V.wheels) {
        if (!V.inContact(wh.index)) continue;
        const point = V.contactPoint(wh.index, this.contactPosition);
        if (!point) continue;
        normal.add(this.ctx.terrain.normalAt(point.x, point.z, this.contactNormal, 0.25));
        contacts++;
      }
      if (contacts >= 3) {
        normal.normalize();
        const side = this.sideDirection.set(1, 0, 0).applyQuaternion(q);
        side.addScaledVector(normal, -side.dot(normal)).normalize();
        const lateralSpeed = V.estLin.dot(side);
        const support = contacts / V.wheels.length;
        const traction = this.contactNormal.copy(normal).multiplyScalar(-PG.G_MARS * normal.y);
        traction.y += PG.G_MARS;
        traction.addScaledVector(side, -lateralSpeed * 6);
        traction.clampLength(0, PG.G_MARS * 0.8 * support).multiplyScalar(V.mass);
        body.addForce(traction, true);
      }
      if (idle || this.steering) {
        for (const wh of V.wheels) { wh.force = 0; wh.brake = idle ? 40 : 25; }
        this.ctl.iv = 0; this.ctl.iw = 0;
        // стоянка: тормоза лучевых колёс Rapier дают медленный «крип», держим точку и курс
        const p = V.position(this._v2);
        if (!this.hold) this.hold = { x: p.x, z: p.z, yaw: V.yaw() };
        const m = V.mass, kx = m * 4, cx = m * 4, ky = this.inertiaY * 4, cy = this.inertiaY * 4;
        body.addForce({ x: -kx * (p.x - this.hold.x) - cx * V.estLin.x, y: 0, z: -kx * (p.z - this.hold.z) - cx * V.estLin.z }, true);
        body.addTorque({ x: 0, y: -ky * PG.wrapAngle(V.yaw() - this.hold.yaw) - cy * V.estAng.y, z: 0 }, true);
        return;
      }
      this.hold = null;
      const C = this.ctl;
      const vMeas = V.forwardSpeed();
      const wMeas = V.estAng.dot(up);
      const ev = v - vMeas, ew = w - wMeas;
      C.iv = PG.clamp(C.iv + ev * dt, -0.8, 0.8);
      C.iw = PG.clamp(C.iw + ew * dt, -0.3, 0.3);
      const Fv = V.mass * (3 * ev + 4 * C.iv);
      const Tw = this.inertiaY * (3 * ew + 4 * C.iw);
      if (contacts >= 3) {
        // Assist slow steering on uneven support without rotating airborne bodies.
        const torque = PG.clamp(Tw, -V.mass * PG.G_MARS * 0.5, V.mass * PG.G_MARS * 0.5);
        body.addTorque({ x: normal.x * torque, y: normal.y * torque, z: normal.z * torque }, true);
      }
      // строки матрицы A: вклад единичной силы колеса в продольную силу и в момент
      let s_aa = 0, s_ab = 0, s_bb = 0;
      for (const wh of V.wheels) {
        if (!V.inContact(wh.index)) {
          wh._a = 0; wh._b = 0;
          continue;
        }
        const sn = Math.sin(wh.steer), cs = Math.cos(wh.steer);
        wh._a = cs;                                   // (−sin φ, −cos φ)·(0, −1)
        wh._b = -wh.pos.z * sn + wh.pos.x * cs;       // (p × d)_y
        s_aa += wh._a * wh._a; s_ab += wh._a * wh._b; s_bb += wh._b * wh._b;
      }
      const det = s_aa * s_bb - s_ab * s_ab || 1e-9;
      const l1 = (s_bb * Fv - s_ab * Tw) / det, l2 = (s_aa * Tw - s_ab * Fv) / det;
      for (const wh of V.wheels) {
        wh.force = PG.clamp(wh._a * l1 + wh._b * l2, -520, 520);
        wh.brake = 0;
      }
      this.driving = true;
    }

    // ---------- мачта и рука ----------
    setMast(pan, tilt) {
      this.mast.tPan = PG.clamp(pan, -Math.PI, Math.PI);
      this.mast.tTilt = PG.clamp(tilt, -1.45, 1.45);
    }
    mastBusy() { return Math.abs(this.mast.pan - this.mast.tPan) > 0.003 || Math.abs(this.mast.tilt - this.mast.tTilt) > 0.003; }

    applyArm() {
      const n = this.nodes, q = this.arm.q;
      n.armBase.rotation.y = q[0]; n.armUpper.rotation.x = q[1]; n.armFore.rotation.x = q[2]; n.armTurret.rotation.x = q[3];
    }
    setArm(q) { this.arm.target = q.slice(); }
    armBusy() { return this.arm.q.some((v, i) => Math.abs(v - this.arm.target[i]) > 0.002); }

    // Обратная кинематика: инструмент подходит к точке по нормали. target/normal — в мировых координатах.
    // Возвращает углы суставов или строку с причиной, если цель недостижима.
    solveArm(targetW, normalW, standoff = 0) {
      const A = this.arm;
      const inv = this.group.matrixWorld.clone().invert();
      const T = targetW.clone().applyMatrix4(inv);
      const nrm = normalW.clone().transformDirection(inv);
      // подход почти сверху: по чистой нормали грани камня запястье уезжает вбок
      nrm.y += 1.5; nrm.normalize();
      const Wt = T.clone().addScaledVector(nrm, A.L3 + standoff);
      const dx = Wt.x - A.B.x, dz = Wt.z - A.B.z;
      const az = Math.atan2(-dx, -dz);
      if (Math.abs(az) > 2.0) return 'цель сбоку — поверните ровер';
      const r = Math.hypot(dx, dz);
      const D = new THREE.Vector2(r - A.S2.x, Wt.y - A.S2.y);
      const d = D.length();
      if (d > A.L1 + A.L2 - 0.02) return `цель вне досягаемости: до неё ${(r + 0.05).toFixed(2)} м от плеча, рука достаёт ~${(A.L1 + A.L2 - 0.1).toFixed(1)} м — подъедьте ближе`;
      if (d < Math.abs(A.L1 - A.L2) + 0.05 || r < 0.55) return 'цель слишком близко к корпусу';
      const g = Math.atan2(D.y, D.x);
      const c1 = PG.clamp((A.L1 * A.L1 + d * d - A.L2 * A.L2) / (2 * A.L1 * d), -1, 1);
      const alpha = g + Math.acos(c1);
      const E = new THREE.Vector2(A.S2.x + A.L1 * Math.cos(alpha), A.S2.y + A.L1 * Math.sin(alpha));
      const beta = Math.atan2(D.y + A.S2.y - E.y, D.x + A.S2.x - E.x);
      // направление инструмента — против нормали (в плоскости руки)
      const tau = Math.atan2(-nrm.y, nrm.x * Math.sin(az) + nrm.z * Math.cos(az));
      const a1 = alpha - A.a0;
      const a2 = beta - A.b0 - a1;
      const a3 = tau - beta;
      return [az, a1, PG.wrapAngle(a2), PG.wrapAngle(a3)];
    }
    // мировая точка инструмента (торец турели)
    toolPoint(out) {
      const n = this.nodes.armTurret;
      return n.localToWorld(out.set(0, this.arm.L3, 0));
    }
    toolDir(out) {
      return out.set(0, 1, 0).transformDirection(this.nodes.armTurret.matrixWorld);
    }

    // ---------- камеры ровера: позиция и ориентация ----------
    mount(name, cam) {
      const n = this.nodes, v = this._v1;
      const set = (obj, local, lookLocal) => {
        obj.updateWorldMatrix(true, false);
        cam.position.copy(local).applyMatrix4(obj.matrixWorld);
        cam.lookAt(v.copy(lookLocal).applyMatrix4(obj.matrixWorld));
        cam.up.set(0, 1, 0);
      };
      const h = n.mastHead;
      switch (name) {
        case 'navcam': set(h, new THREE.Vector3(-0.17, 0.12, -0.16), new THREE.Vector3(-0.17, 0.12, -10)); break;
        case 'mastcam34': set(h, new THREE.Vector3(0.0, 0.16, -0.17), new THREE.Vector3(0.0, 0.16, -10)); break;
        case 'mastcam100': set(h, new THREE.Vector3(0.05, 0.16, -0.17), new THREE.Vector3(0.05, 0.16, -10)); break;
        case 'chemcam': set(h, new THREE.Vector3(0.0, 0.25, -0.17), new THREE.Vector3(0.0, 0.25, -10)); break;
        case 'fhaz': set(this.model, new THREE.Vector3(0, 0.72, -1.02), new THREE.Vector3(0, -1.2, -4)); break;
        case 'rhaz': set(this.model, new THREE.Vector3(0, 0.8, 1.2), new THREE.Vector3(0, -1.2, 5)); break;
        case 'mardi': set(this.model, new THREE.Vector3(-0.45, 0.5, -0.5), new THREE.Vector3(-0.45, -5, -0.52)); break;
        case 'mahli': {
          const tp = this.toolPoint(new THREE.Vector3()), td = this.toolDir(new THREE.Vector3());
          cam.position.copy(tp).addScaledVector(td, -0.02);
          cam.up.set(0, 1, 0);
          if (Math.abs(td.y) > 0.95) cam.up.set(0, 0, -1).applyQuaternion(this.group.quaternion);
          cam.lookAt(v.copy(tp).add(td));
          break;
        }
      }
    }
    // точка, куда «смотрит» мачта (для ChemCam): луч из головы
    mastRay(out) {
      const h = this.nodes.mastHead;
      h.updateWorldMatrix(true, false);
      const o = new THREE.Vector3(0, 0.25, -0.17).applyMatrix4(h.matrixWorld);
      const d = new THREE.Vector3(0, 0, -1).transformDirection(h.matrixWorld);
      return out.set(o, d);
    }
    // наведение мачты на мировую точку
    aimMastAt(p) {
      const h = this.nodes.mastPan;
      const local = this.model.worldToLocal(p.clone());
      const hp = h.position;
      const dx = local.x - hp.x, dz = local.z - hp.z, dy = local.y - (hp.y + 0.9);
      const pan = Math.atan2(-dx, -dz);
      const tilt = Math.atan2(dy, Math.hypot(dx, dz));
      this.setMast(pan, tilt);
    }

    // ---------- кадр ----------
    update(dt, simDt) {
      const V = this.vehicle;
      V.position(this.group.position);
      V.quaternion(this.group.quaternion);
      this.group.updateMatrixWorld(true);
      // мачта и рука двигаются в сим-времени
      const m = this.mast;
      m.pan = PG.approach(m.pan, m.tPan, MAST_RATE * simDt);
      m.tilt = PG.approach(m.tilt, m.tTilt, MAST_RATE * simDt);
      this.nodes.mastPan.rotation.y = m.pan;
      this.nodes.mastHead.rotation.x = m.tilt;
      const A = this.arm;
      for (let i = 0; i < 4; i++) A.q[i] = PG.approach(A.q[i], A.target[i], ARM_RATE * simDt);
      this.applyArm();

      // рокеры и боги по ходам подвесок
      const P = this.pivot, d = {};
      ORDER.forEach((k, i) => { d[k] = this.equilibrium - (V.suspension(i) ?? this.equilibrium); });
      for (const s of ['L', 'R']) {
        const zF = this.restWheel['F' + s].z, zM = this.restWheel['M' + s].z, zB = this.restWheel['B' + s].z;
        const dzM = zM - P.bogie.z, dzB = zB - P.bogie.z;
        const thB = (d['M' + s] - d['B' + s]) / (dzB - dzM);
        const dP = d['M' + s] + dzM * thB;
        const dzF = zF - P.rocker.z, dzP = P.bogie.z - P.rocker.z;
        const thR = (d['F' + s] * -dzF + dP * -dzP) / (dzF * dzF + dzP * dzP);
        this.nodes.rocker[s].rotation.x = PG.clamp(thR, -0.5, 0.5);
        this.nodes.bogie[s].rotation.x = PG.clamp(thB - thR, -0.6, 0.6);
      }
      ORDER.forEach((k, i) => {
        const wh = V.wheels[i];
        if (this.nodes.steer[k]) this.nodes.steer[k].rotation.y = wh.steer;
        this.nodes.wheel[k].rotation.x = V.rotation(i) || 0;
        // следы
        if (V.inContact(i) && V.contactPoint(i, this._v1)) this.trails[i].push(this._v1, 0.06);
        else this.trails[i].break();
      });
      // одометрия и пробуксовка (сравнение пути корпуса и оборотов колёс)
      const p = this._v2.copy(this.group.position);
      const step = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
      if (step < 2) this.odometer += step;
      this.lastPos.copy(p);
      let wheelDist = 0;
      ORDER.forEach((k, i) => { const r = V.rotation(i) || 0; wheelDist += Math.abs(r - this.lastRot[i]) * WHEEL_R / 6; this.lastRot[i] = r; });
      // пробуксовку считаем только на прямом ходу (в повороте колёса крутятся без пути корпуса)
      if (Math.abs(this.cmd.w) < 1e-6 && Math.abs(this.cmd.v) > 0) { this.slipAcc.body += step; this.slipAcc.wheel += wheelDist; }
      if (this.slipAcc.wheel > 0.2) {
        this.slip = PG.clamp(1 - this.slipAcc.body / this.slipAcc.wheel, 0, 1);
        this.slipAcc.body = this.slipAcc.wheel = 0;
      }
      // пыль из-под колёс на скорости (при ускорении времени)
      const sp = Math.abs(V.forwardSpeed());
      if (sp > 0.01 && this.ctx.dust && Math.random() < sp * 2 * dt * 60) {
        const i = Math.floor(Math.random() * 6);
        if (V.inContact(i) && V.contactPoint(i, this._v1)) this.ctx.dust.emit(this._v1.x, this._v1.y + 0.05, this._v1.z, (Math.random() - 0.5) * 0.1, 0.05, (Math.random() - 0.5) * 0.1, 0.08, 3, 0.6);
      }
    }

    get speed() { return this.vehicle.forwardSpeed(); }
    heading() { return this.vehicle.yaw(); }
    reset() {
      const p = this.vehicle.position(new THREE.Vector3());
      p.y = this.ctx.terrain.heightAt(p.x, p.z) + 0.6;
      this.vehicle.reset(p, this.vehicle.yaw());
      this.trails.forEach((t) => t.break());
    }
    setVisible(v) { this.group.visible = v; }
  };
})(window.PG);
