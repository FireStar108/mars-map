'use strict';
// Физика: мир Rapier с марсианской гравитацией, фиксированный шаг с ускорением времени,
// и обёртка колёсной машины на лучевом контроллере (DynamicRayCastVehicleController).
(function (PG) {
  PG.Physics = class {
    constructor() {
      this.baseDt = 1 / 120;
      this.maxSteps = 160;      // предел шагов за кадр; дальше растёт шаг (до maxDt)
      this.maxDt = 1 / 90;      // крупнее — тормоза, демпферы и боковое трение рулевых колёс раскачивают корпус
      this.acc = 0;
      this.time = 0;
      this.bodies = [];         // объекты с preStep(dt)/postStep(dt)
    }
    async init() {
      await RAPIER.init();
      this.world = new RAPIER.World({ x: 0, y: -PG.G_MARS, z: 0 });
    }
    add(obj) { this.bodies.push(obj); }
    remove(obj) { this.bodies = this.bodies.filter((b) => b !== obj); }

    // Продвигает симуляцию на simDt секунд; возвращает реально просчитанное время.
    step(simDt) {
      this.acc += simDt;
      let h = this.baseDt;
      if (this.acc > this.maxSteps * h) h = Math.min(this.acc / this.maxSteps, this.maxDt);
      let n = 0, done = 0;
      while (this.acc >= h && n < this.maxSteps) {
        for (const b of this.bodies) b.preStep && b.preStep(h);
        this.world.timestep = h;
        this.world.step();
        for (const b of this.bodies) b.postStep && b.postStep(h);
        this.acc -= h; done += h; n++;
      }
      if (this.acc > h * 2) this.acc = 0;     // не копим долг, если не успеваем
      this.time += done;
      this.lastSteps = n;
      this.lastDt = h;
      return done;
    }

    castRay(origin, dir, maxToi, excludeBody) {
      const ray = new RAPIER.Ray(origin, dir);
      const hit = this.world.castRay(ray, maxToi, true, undefined, undefined, undefined, excludeBody);
      return hit ? { toi: hit.timeOfImpact, collider: hit.collider } : null;
    }
  };

  // Колёсная машина. Контроллер Rapier согласован только в своей «родной» конвенции:
  // вперёд = +X тела, ось колеса = −Z (иначе тяга и боковое сцепление рулевых колёс
  // расходятся и машину крутит). Модели смотрят в −Z, поэтому тело повёрнуто на +90°
  // относительно модели: точка модели (x, y, z) → тело (−z, y, x). Наружу всё отдаётся
  // в координатах модели. Положительная сила колеса — вперёд, руль φ > 0 — влево.
  const toBody = (x, y, z) => ({ x: -z, y, z: x });
  const MODEL_IN_BODY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);

  PG.WheeledVehicle = class {
    constructor(physics, opts) {
      this.physics = physics;
      this.opts = opts;
      const W = physics.world;
      const bd = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(opts.position.x, opts.position.y, opts.position.z)
        .setLinearDamping(opts.linearDamping || 0.02)
        .setAngularDamping(opts.angularDamping || 0.4)
        .setCanSleep(false)
        .setRotation(bodyQuat(opts.yaw || 0));
      this.body = W.createRigidBody(bd);
      this.body.userData = { kind: opts.kind };
      for (const c of opts.chassis) {
        const cd = RAPIER.ColliderDesc.cuboid(c.half[2], c.half[1], c.half[0])
          .setTranslation(-c.offset[2], c.offset[1], c.offset[0]).setFriction(0.6).setRestitution(0.05);
        if (c.mass !== undefined) cd.setMass(c.mass);
        W.createCollider(cd, this.body);
      }
      if (opts.centerOfMass) {
        // лишняя масса внизу смещает центр тяжести — устойчивость на склонах
        const o = opts.centerOfMass.offset;
        const cd = RAPIER.ColliderDesc.ball(0.05).setTranslation(-o[2], o[1], o[0])
          .setMass(opts.centerOfMass.mass).setSensor(true);
        W.createCollider(cd, this.body);
      }
      this.ctrl = W.createVehicleController(this.body);
      this.wheels = opts.wheels.map((w, i) => {
        const conn = toBody(w.pos.x, w.pos.y + w.rest - (w.sag || 0), w.pos.z);
        this.ctrl.addWheel(conn, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: -1 }, w.rest, w.radius);
        this.ctrl.setWheelSuspensionStiffness(i, w.stiffness);
        this.ctrl.setWheelSuspensionCompression(i, w.compression);
        this.ctrl.setWheelSuspensionRelaxation(i, w.relaxation);
        this.ctrl.setWheelFrictionSlip(i, w.friction);
        this.ctrl.setWheelSideFrictionStiffness(i, w.sideStiffness ?? 1);
        this.ctrl.setWheelMaxSuspensionTravel(i, w.travel ?? w.rest);
        this.ctrl.setWheelMaxSuspensionForce(i, w.maxForce ?? 1e5);
        return { ...w, conn, steer: 0, force: 0, brake: 0, index: i };
      });
      this.control = null;   // (dt) => void — закон управления на каждом подшаге
      // Скорости корпуса по фактическому смещению за шаг: linvel/angvel, которые видны
      // между шагами, содержат импульсы подвески и «дрожат» даже у стоящей машины.
      this.estLin = new THREE.Vector3(); this.estAng = new THREE.Vector3();
      this.prevPos = new THREE.Vector3(); this.prevQuat = new THREE.Quaternion(); this.hasPrev = false;
      this._dq = new THREE.Quaternion(); this._p = new THREE.Vector3();
      this._v = new THREE.Vector3(); this._q = new THREE.Quaternion();
      physics.add(this);
    }

    preStep(dt) {
      if (this.control) this.control(dt);
      for (const w of this.wheels) {
        this.ctrl.setWheelSteering(w.index, w.steer);
        this.ctrl.setWheelEngineForce(w.index, -w.force);   // у Rapier отрицательная сила — вперёд
        this.ctrl.setWheelBrake(w.index, w.brake);
      }
      this.ctrl.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    }

    postStep(dt) {
      const p = this.position(this._p), q = this.quaternion(this._q);
      if (this.hasPrev) {
        this.estLin.subVectors(p, this.prevPos).divideScalar(dt);
        const d = this._dq.copy(q).multiply(this.prevQuat.invert());
        if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w);
        // малые углы: через |xyz| (acos(w) при w≈1 теряет точность и даёт ноль)
        const s = Math.hypot(d.x, d.y, d.z);
        const ang = 2 * Math.atan2(s, d.w);
        if (s > 1e-12) this.estAng.set(d.x / s, d.y / s, d.z / s).multiplyScalar(ang / dt); else this.estAng.set(0, 0, 0);
      }
      this.prevPos.copy(p); this.prevQuat.copy(q); this.hasPrev = true;
    }

    get mass() { return this.body.mass(); }
    position(out) { const t = this.body.translation(); return out.set(t.x, t.y, t.z); }
    quaternion(out) { const r = this.body.rotation(); return out.set(r.x, r.y, r.z, r.w).multiply(MODEL_IN_BODY); }
    velocity(out) { const v = this.body.linvel(); return out.set(v.x, v.y, v.z); }
    angvel(out) { const v = this.body.angvel(); return out.set(v.x, v.y, v.z); }
    // скорость вдоль оси «вперёд» (−Z), м/с
    forwardSpeed() {
      const f = this._v.set(0, 0, -1).applyQuaternion(this.quaternion(this._q));
      return f.dot(this.estLin);
    }
    contacts() { let n = 0; for (const w of this.wheels) if (this.ctrl.wheelIsInContact(w.index)) n++; return n; }
    inContact(i) { return this.ctrl.wheelIsInContact(i); }
    suspension(i) { return this.ctrl.wheelSuspensionLength(i); }
    rotation(i) { return this.ctrl.wheelRotation(i); }
    contactPoint(i, out) {
      const p = this.ctrl.wheelContactPoint(i);
      return p ? out.set(p.x, p.y, p.z) : null;
    }

    // Скорость точки корпуса в мире (для регуляторов скорости колёс).
    pointVelocity(worldPoint, out) {
      const v = this.estLin, w = this.estAng, c = this.prevPos;
      const rx = worldPoint.x - c.x, ry = worldPoint.y - c.y, rz = worldPoint.z - c.z;
      return out.set(v.x + w.y * rz - w.z * ry, v.y + w.z * rx - w.x * rz, v.z + w.x * ry - w.y * rx);
    }

    reset(pos, yaw) {
      this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
      this.body.setRotation(bodyQuat(yaw), true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.hasPrev = false; this.estLin.set(0, 0, 0); this.estAng.set(0, 0, 0);
      if (this.onReset) this.onReset();
    }

    yaw() {
      const q = this.quaternion(this._q);
      const f = this._v.set(0, 0, -1).applyQuaternion(q);
      return Math.atan2(-f.x, -f.z);
    }

    dispose() {
      this.physics.remove(this);
      this.physics.world.removeVehicleController(this.ctrl);
      this.physics.world.removeRigidBody(this.body);
    }
  };

  function yawQuat(yaw) { return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }; }
  // поворот тела для курса модели yaw (тело = модель · (+90°))
  function bodyQuat(yaw) { return yawQuat(yaw + Math.PI / 2); }
  PG.yawQuat = yawQuat;
})(window.PG);
