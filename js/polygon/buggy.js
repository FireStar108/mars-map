'use strict';
// Игрушечный багги с ракетным ускорителем и зелёным пришельцем в очках.
// Чем сильнее разгон, тем шире улыбка и дальше высунут язык (рот рисуется прямо в текстуре лица).
(function (PG) {
  const DRAG = 1.2;                 // «аркадное» сопротивление, Н/(м/с)²
  const ENGINE_FORCE = 1100;        // Н на колесо
  const ENGINE_POWER = 9000;        // Вт на колесо (ограничение тяги на скорости)
  const ROCKET_THRUST = 4200;       // Н
  const BOOST_DRAIN = 0.16, BOOST_REGEN = 0.09;

  // UV лица пришельца (измерено в Blender): центр рта и масштаб «пикселей текстуры на метр»
  const FACE = { u: 0.2961, v: 0.3009, perMeter: 0.2015 };

  PG.Buggy = class {
    constructor(ctx, gBuggy, gAlien, spawn) {
      this.ctx = ctx;
      this.kind = 'buggy';
      this.name = 'Багги';
      this.group = new THREE.Group();
      this.model = gBuggy.scene;
      this.group.add(this.model);
      ctx.scene.add(this.group);
      this.model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        o.material.metalness = Math.min(o.material.metalness, 0.3);
      });
      this.model.updateMatrixWorld(true);
      this.wheelNodes = ['FL', 'FR', 'BL', 'BR'].map((k) => {
        const n = this.model.getObjectByName('wheel' + k);
        if (!n) throw new Error('в модели багги нет колеса ' + k);
        n.rotation.order = 'YXZ';
        return n;
      });
      this.restWheel = this.wheelNodes.map((n) => n.position.clone());
      const restWorld = this.wheelNodes.map((n) => n.getWorldPosition(new THREE.Vector3()));

      const stiffness = 34, sag = PG.G_MARS / (4 * stiffness);
      const wheels = restWorld.map((p, i) => ({
        pos: p, radius: i < 2 ? 0.385 : 0.405, rest: 0.34, sag, stiffness,
        compression: 2.4, relaxation: 3.2, friction: 2.6, sideStiffness: 1.3, travel: 0.32, maxForce: 2e5,
        front: i < 2,
      }));
      this.equilibrium = 0.34 - sag;
      const y0 = ctx.terrain.heightAt(spawn.x, spawn.z) + 0.4;
      this.vehicle = new PG.WheeledVehicle(ctx.physics, {
        kind: 'buggy', position: { x: spawn.x, y: y0, z: spawn.z }, yaw: spawn.yaw || 0,
        chassis: [{ half: [0.7, 0.26, 1.6], offset: [0, 0.68, 0.05], mass: 330 }, { half: [0.45, 0.25, 0.5], offset: [0, 1.15, 0.3], mass: 0 }],
        centerOfMass: { offset: [0, 0.12, 0.05], mass: 280 },     // низкий центр масс — меньше кувырков
        angularDamping: 0.9, linearDamping: 0.0,
        wheels,
      });
      this.vehicle.control = (dt) => this.control(dt);
      this.input = { throttle: 0, steer: 0, brake: false, rocket: false };
      this.steer = 0;
      this.boost = 1;
      this.rocketOn = 0;
      this.joy = 0;
      this.accel = 0;
      this.prevSpeed = 0;
      this.trails = wheels.map(() => ctx.tracks.trail('buggy', 0.3, 0.55, 3000));
      this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._f = new THREE.Vector3();

      this.buildRocket();
      this.buildAlien(gAlien);
    }

    buildRocket() {
      const g = new THREE.Group();
      g.position.set(0, 1.02, 1.78);
      const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.6, roughness: 0.35 });
      const red = new THREE.MeshStandardMaterial({ color: 0xd8341c, metalness: 0.2, roughness: 0.5 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.5, roughness: 0.5 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.8, 24), metal);
      body.rotation.x = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 24), red);
      nose.rotation.x = -Math.PI / 2; nose.position.z = -0.55;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.08, 24), red);
      band.rotation.x = Math.PI / 2; band.position.z = 0.15;
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.19, 0.26, 24, 1, true), dark);
      bell.material.side = THREE.DoubleSide;
      bell.rotation.x = Math.PI / 2; bell.position.z = 0.52;
      g.add(body, nose, band, bell);
      for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.28), red);
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        fin.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.25); fin.rotation.z = a - Math.PI / 2;
        g.add(fin);
      }
      // крепление к раме
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), dark);
      strut.position.set(0, -0.2, 0); g.add(strut);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      // пламя: конус с шумом, длина зависит от тяги
      this.flameMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPower: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform float uTime; uniform float uPower; varying vec2 vUv;
          float h(float n){ return fract(sin(n)*43758.5453); }
          float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(h(i.x+i.y*57.0),h(i.x+1.0+i.y*57.0),f.x),mix(h(i.x+(i.y+1.0)*57.0),h(i.x+1.0+(i.y+1.0)*57.0),f.x),f.y); }
          void main(){ float t = vUv.y; float n = noise(vec2(vUv.x*8.0, t*6.0 - uTime*30.0));
            float core = smoothstep(0.0, 1.0, t) * (0.6 + 0.4*n);
            vec3 col = mix(vec3(1.0,0.35,0.05), vec3(1.0,0.95,0.7), smoothstep(0.55,1.0,t));
            col = mix(col, vec3(0.5,0.6,1.0), smoothstep(0.92,1.0,t)*0.6);
            gl_FragColor = vec4(col * 2.2, core * uPower); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.17, 1.6, 20, 1, true), this.flameMat);
      flame.geometry.translate(0, -0.8, 0);
      flame.rotation.x = -Math.PI / 2;
      flame.position.z = 0.62;
      this.flame = flame;
      g.add(flame);
      this.rocketLight = new THREE.PointLight(0xff8a3a, 0, 14, 1.6);
      this.rocketLight.position.set(0, 0, 1.0);
      g.add(this.rocketLight);
      this.rocket = g;
      this.model.add(g);
    }

    buildAlien(gAlien) {
      const pivot = new THREE.Group();
      const a = gAlien.scene;
      pivot.add(a);
      a.rotation.y = Math.PI;              // лицом вперёд (−Z)
      // анимация двигает корневую кость — рамку считаем уже в её первом кадре
      this.mixer = new THREE.AnimationMixer(a);
      if (gAlien.animations[0]) this.mixer.clipAction(gAlien.animations[0]).play();
      this.mixer.update(0);
      a.updateMatrixWorld(true);
      // рамка по вершинам тела со скиннингом (рамка позы привязки у этой модели огромная)
      const box = new THREE.Box3();
      a.traverse((o) => { if (o.isSkinnedMesh) box.expandByObject(o, true); });
      const c = box.getCenter(new THREE.Vector3());
      a.position.set(-c.x, -box.min.y, -c.z);
      const scale = 0.8 / (box.max.y - box.min.y);
      pivot.scale.setScalar(scale);
      pivot.position.set(0, 0.5, 0.22);
      this.model.add(pivot);
      this.alien = pivot;
      a.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.frustumCulled = false;
        if (o.material.name === 'Outline') { o.material.side = THREE.FrontSide; o.material.color.set(0x0a1404); }   // вывернутая оболочка-обводка
      });
      this.tongue = a.getObjectByName('tongue');
      // у узла языка при экспорте потерялось смещение от кости; локальная система очков —
      // это координаты Blender (Y вверх), поэтому вешаем язык на очки в точку рта
      const shades = a.getObjectByName('shades');
      if (this.tongue && shades) {
        shades.add(this.tongue);
        this.tongue.position.set(0.22, 2.45, 0.79);
        this.tongue.quaternion.identity();
      }
      this.tongueBase = this.tongue ? this.tongue.quaternion.clone() : null;
      if (this.tongue) this.tongue.scale.setScalar(0.001);
      // лицо: перерисовываем текстуру тела с нужной улыбкой
      let bodyMat = null;
      a.traverse((o) => { if (o.isMesh && o.material.map && !bodyMat) bodyMat = o.material; });
      this.faceLevel = -1;
      if (bodyMat) {
        const img = bodyMat.map.image;
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        this.face = { mat: bodyMat, img, cv, ctx: cv.getContext('2d') };
        const tex = new THREE.CanvasTexture(cv);
        tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = bodyMat.map.wrapS; tex.wrapT = bodyMat.map.wrapT;
        bodyMat.map = tex;
        bodyMat.needsUpdate = true;
        this.drawFace(0);
      }
    }

    // level 0 — спокойная улыбка, 1 — оскал до ушей с зубами и языком
    drawFace(level) {
      const F = this.face; if (!F) return;
      const W = F.cv.width, H = F.cv.height, g = F.ctx;
      g.drawImage(F.img, 0, 0, W, H);
      const s = FACE.perMeter * W, u0 = FACE.u * W, v0 = FACE.v * H;
      const P = (x, y) => [u0 - x * s, v0 - y * s];   // метры лица → пиксели (по горизонтали зеркально)
      const w = 0.075 + 0.16 * level, c = 0.028 + 0.025 * level, depth = 0.012 + 0.2 * level;
      g.lineJoin = 'round'; g.lineCap = 'round';
      if (level < 0.06) {
        g.beginPath(); g.moveTo(...P(-w, c));
        g.quadraticCurveTo(...P(0, -c * 1.2), ...P(w, c));
        g.strokeStyle = '#120806'; g.lineWidth = Math.max(1.5, 0.012 * s); g.stroke();
        F.mat.map.needsUpdate = true;
        return;
      }
      const top = () => { g.moveTo(...P(-w, c)); g.quadraticCurveTo(...P(0, c - 0.04 - 0.02 * level), ...P(w, c)); };
      g.beginPath(); top();
      g.quadraticCurveTo(...P(0, c - 2 * depth), ...P(-w, c)); g.closePath();
      g.save();
      g.fillStyle = '#3c0b14'; g.fill();
      g.clip();
      // язык в глубине рта
      if (level > 0.3) {
        const [tx, ty] = P(0, c - depth * 1.25);
        g.fillStyle = '#ef5d7c';
        g.beginPath(); g.ellipse(tx, ty, w * 0.55 * s, depth * 0.55 * s, 0, 0, Math.PI * 2); g.fill();
      }
      // верхние зубы
      g.beginPath(); top();
      g.lineTo(...P(w, c - 0.035 * level)); g.quadraticCurveTo(...P(0, c - 0.075 - 0.03 * level), ...P(-w, c - 0.035 * level)); g.closePath();
      g.fillStyle = '#fbf8ef'; g.fill();
      g.restore();
      g.beginPath(); top(); g.quadraticCurveTo(...P(0, c - 2 * depth), ...P(-w, c));
      g.strokeStyle = '#120806'; g.lineWidth = Math.max(1.5, 0.012 * s); g.stroke();
      F.mat.map.needsUpdate = true;
    }

    control(dt) {
      const V = this.vehicle, I = this.input, body = V.body;
      const q = V.quaternion(this._q);
      const fwd = this._f.set(0, 0, -1).applyQuaternion(q);
      const lv = body.linvel();
      const speed = fwd.x * lv.x + fwd.y * lv.y + fwd.z * lv.z;
      const sp = Math.abs(speed);
      // руль: меньше угол на скорости
      const maxSteer = 0.55 / (1 + sp / 14);
      this.steer = PG.approach(this.steer, I.steer * maxSteer, 2.6 * dt);
      const per = Math.min(ENGINE_FORCE, ENGINE_POWER / (sp + 0.5));
      let throttle = I.throttle;
      let braking = 0;
      if (throttle < 0 && speed > 1.5) { braking = 18; throttle = 0; }       // «назад» на ходу = тормоз
      if (throttle > 0 && speed < -1.5) { braking = 18; throttle = 0; }
      if (throttle < 0 && speed < -9) throttle = 0;                          // задний ход до ~32 км/ч
      for (const w of V.wheels) {
        w.steer = w.front ? this.steer : 0;
        w.force = throttle * per * (throttle < 0 ? 0.6 : 1);
        w.brake = braking + (I.brake && !w.front ? 30 : 0) + (Math.abs(I.throttle) < 0.01 && sp < 0.6 ? 6 : 0);
        V.ctrl.setWheelSideFrictionStiffness(w.index, I.brake && !w.front ? 0.75 : w.sideStiffness);
      }
      body.resetForces(true);
      body.resetTorques(true);
      const vv = Math.hypot(lv.x, lv.y, lv.z);
      if (vv > 0.1) body.addForce({ x: -lv.x * vv * DRAG, y: -lv.y * vv * DRAG, z: -lv.z * vv * DRAG }, true);
      this.rocketOn = I.rocket && this.boost > 0.02 ? 1 : 0;
      this.boost = PG.clamp(this.boost + (this.rocketOn ? -BOOST_DRAIN : BOOST_REGEN) * dt, 0, 1);
      if (this.rocketOn) body.addForce({ x: fwd.x * ROCKET_THRUST, y: fwd.y * ROCKET_THRUST, z: fwd.z * ROCKET_THRUST }, true);
      const grounded = V.contacts();
      if (grounded >= 2) {
        // прижим (аркадный: на Марсе воздух почти не держит) и «ESP» по рысканью
        const down = Math.min(3500, 1.6 * speed * speed);
        const up = this._v.set(0, 1, 0).applyQuaternion(q);
        body.addForce({ x: -up.x * down, y: -up.y * down, z: -up.z * down }, true);
        const wantYaw = speed * Math.tan(this.steer) / 2.27;
        const yawErr = V.estAng.dot(up) - wantYaw;
        const k = -yawErr * 700 * Math.min(1, sp / 6);
        body.addTorque({ x: up.x * k, y: up.y * k, z: up.z * k }, true);
      }
      // в полёте и на двух колёсах машину мягко выравнивает (аркада), газ/руль добавляют вращение
      if (grounded < 3) {
        const up = this._v.set(0, 1, 0).applyQuaternion(q);
        const ax = -up.z, az = up.x;                       // ось = up × (0,1,0)
        const k = grounded === 0 ? 2600 : 1400, c = 1500;
        const w = V.estAng;
        let tx = ax * k - w.x * c, tz = az * k - w.z * c;
        if (grounded === 0) {
          const right = this._f.set(1, 0, 0).applyQuaternion(q);
          const pitch = -I.throttle * 900;
          tx += right.x * pitch; tz += right.z * pitch;
          body.addTorque({ x: tx, y: right.y * pitch + I.steer * 420, z: tz }, true);
        } else body.addTorque({ x: tx, y: 0, z: tz }, true);
      }
    }

    update(dt, _simDt, t) {
      const V = this.vehicle;
      V.position(this.group.position);
      V.quaternion(this.group.quaternion);
      this.group.updateMatrixWorld(true);
      const speed = V.forwardSpeed();
      this.accel = PG.damp(this.accel, (speed - this.prevSpeed) / Math.max(dt, 1e-3), 6, dt);
      this.prevSpeed = speed;
      this.wheelNodes.forEach((n, i) => {
        const w = V.wheels[i];
        const susp = V.suspension(i) ?? this.equilibrium;
        n.position.y = this.restWheel[i].y + (this.equilibrium - susp);
        n.rotation.y = w.steer;
        n.rotation.x = V.rotation(i) || 0;
        const tr = this.trails[i];
        if (V.inContact(i) && V.contactPoint(i, this._v)) {
          tr.push(this._v, 0.12);
          const slip = Math.abs(speed) > 4 || (this.input.brake && Math.abs(speed) > 2);
          if (slip && Math.random() < 0.7) {
            const k = Math.min(1, Math.abs(speed) / 20);
            this.ctx.dust.emit(this._v.x, this._v.y + 0.1, this._v.z, (Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.6 * k, (Math.random() - 0.5) * 2, 0.35 + 0.4 * k, 2.5 + Math.random() * 2, 1.2);
          }
        } else tr.break();
      });
      // ракета: пламя, свет, выхлоп
      this.rocketOn = this.rocketOn || 0;
      this.flamePower = PG.damp(this.flamePower || 0, this.rocketOn, 14, dt);
      this.flameMat.uniforms.uTime.value = t;
      this.flameMat.uniforms.uPower.value = this.flamePower;
      this.flame.scale.set(1, 0.3 + this.flamePower * (0.9 + Math.random() * 0.25), 1);
      this.flame.visible = this.flamePower > 0.02;
      this.rocketLight.intensity = this.flamePower * (30 + Math.random() * 10);
      if (this.flamePower > 0.1) {
        const p = this.rocket.localToWorld(this._v.set(0, 0, 0.7));
        const back = this._f.set(0, 0, 1).applyQuaternion(this.group.quaternion);
        const lv = V.velocity(new THREE.Vector3());
        for (let k = 0; k < 3; k++) {
          this.ctx.fire.emit(p.x, p.y, p.z, lv.x + back.x * 14 + (Math.random() - 0.5) * 2, lv.y + back.y * 14 + (Math.random() - 0.5) * 2, lv.z + back.z * 14 + (Math.random() - 0.5) * 2, 0.35, 0.25 + Math.random() * 0.15, 2);
        }
        if (Math.random() < 0.5) this.ctx.dust.emit(p.x, p.y, p.z, lv.x * 0.3 + back.x * 4, lv.y * 0.3 + 0.5, lv.z * 0.3 + back.z * 4, 0.5, 3, 1.4);
      }
      // настроение пришельца
      const airborne = V.contacts() === 0;
      const target = PG.clamp(Math.max(this.accel / 3.2, Math.abs(speed) / 22, this.rocketOn ? 1 : 0, airborne && Math.abs(speed) > 5 ? 0.8 : 0), 0, 1);
      this.joy = PG.damp(this.joy, target, target > this.joy ? 5 : 1.2, dt);
      const level = Math.round(this.joy * 10) / 10;
      if (level !== this.faceLevel) { this.faceLevel = level; this.drawFace(level); }
      if (this.tongue) {
        const out = PG.clamp((this.joy - 0.35) / 0.4, 0, 1);
        this.tongue.scale.setScalar(Math.max(0.001, out));
        const flap = Math.min(1, Math.abs(speed) / 15);
        this.tongue.quaternion.copy(this.tongueBase);
        this.tongue.rotateX(-0.35 * flap + Math.sin(t * (8 + 14 * flap)) * 0.22 * flap);
        this.tongue.rotateZ(Math.sin(t * (11 + 10 * flap) + 1.3) * 0.35 * flap);
      }
      this.mixer.update(dt * (1 + this.joy * 2.5));
      // пришельца покачивает на ухабах и при разгоне
      this.alien.rotation.x = PG.damp(this.alien.rotation.x, PG.clamp(this.accel * 0.025, -0.25, 0.25), 8, dt);
      this.alien.rotation.z = PG.damp(this.alien.rotation.z, PG.clamp(-this.steer * Math.abs(speed) * 0.02, -0.25, 0.25), 6, dt);
    }

    get speed() { return this.vehicle.forwardSpeed(); }
    heading() { return this.vehicle.yaw(); }
    reset() {
      const p = this.vehicle.position(new THREE.Vector3());
      p.y = this.ctx.terrain.heightAt(p.x, p.z) + 1.2;
      this.vehicle.reset(p, this.vehicle.yaw());
      this.trails.forEach((t) => t.break());
    }
    setVisible(v) { this.group.visible = v; }
  };
})(window.PG);
