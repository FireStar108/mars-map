'use strict';
// Камеры: внешняя (орбита вокруг машины) и камеры ровера с фильтрами как у настоящих приборов.
(function (PG) {
  // filter: 0 цвет, 1 ч/б, 2 ч/б «рыбий глаз», 3 ч/б круглый кадр (RMI), 4 цвет MAHLI
  const CAMS = {
    chase:      { label: 'Внешняя камера', fov: 55, filter: -1 },
    hood:       { label: 'За пилотом', fov: 70, filter: -1, buggy: true },
    navcam:     { label: 'Navcam · ч/б стереопара · 45°', fov: 45, filter: 1, mast: true },
    mastcam34:  { label: 'Mastcam M-34 · 34 мм · цвет', fov: 15, filter: 0, mast: true },
    mastcam100: { label: 'Mastcam M-100 · 100 мм · цвет', fov: 5.1, filter: 0, mast: true },
    chemcam:    { label: 'ChemCam RMI · телескоп 110 мм', fov: 1.1, filter: 3, mast: true },
    fhaz:       { label: 'Hazcam передняя · 124° · ч/б', fov: 100, filter: 2 },
    rhaz:       { label: 'Hazcam задняя · 124° · ч/б', fov: 100, filter: 2 },
    mahli:      { label: 'MAHLI · на турели руки · LED', fov: 34, filter: 4 },
    mardi:      { label: 'MARDI · под корпусом · 70°', fov: 70, filter: 0 },
  };
  PG.CAMS = CAMS;
  const ROVER_CAMS = ['chase', 'navcam', 'mastcam34', 'mastcam100', 'chemcam', 'fhaz', 'rhaz', 'mahli', 'mardi'];
  const BUGGY_CAMS = ['chase', 'hood'];

  PG.Views = class {
    constructor(app) {
      this.app = app;
      const r = app.renderer;
      this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.02, 6000);
      this.mode = 'chase';
      this.orbit = { yaw: 0.6, pitch: 0.32, dist: 8, manualUntil: 0, target: new THREE.Vector3(), init: false };
      this.rt = new THREE.WebGLRenderTarget(16, 16, { samples: 4, type: THREE.HalfFloatType });
      this.postMat = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, uMode: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: `
          uniform sampler2D tDiffuse; uniform int uMode; uniform float uTime; uniform float uAspect; varying vec2 vUv;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
          void main(){
            vec2 uv = vUv; vec2 c = uv - 0.5; c.x *= uAspect;
            if (uMode == 2) { float r2 = dot(c, c); vec2 k = (uv - 0.5) * (0.78 + 0.5 * r2); uv = 0.5 + k; }
            vec3 col = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
            float lum = dot(col, vec3(0.3, 0.59, 0.11));
            if (uMode == 1 || uMode == 2 || uMode == 3) col = vec3(lum) * 1.15 + (hash(vUv * 731.0) - 0.5) * 0.025;
            if (uMode == 4) col *= vec3(1.06, 1.0, 0.94);
            float vig = 1.0 - smoothstep(0.45, 1.0, length(c) * 1.1);
            col *= mix(1.0, vig, uMode == 0 ? 0.4 : 0.7);
            if (uMode == 3) col *= 1.0 - smoothstep(0.43, 0.445, length(c));
            if (uMode == 2) col *= 1.0 - smoothstep(0.62, 0.66, length(c));
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        depthTest: false, depthWrite: false,
      });
      this.postScene = new THREE.Scene();
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat);
      quad.frustumCulled = false;
      this.postScene.add(quad);
      this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.pip = null;           // имя камеры в окне «картинка в картинке»
      this.pipRT = new THREE.WebGLRenderTarget(480, 360, { samples: 4, type: THREE.HalfFloatType });
      this.pipCam = new THREE.PerspectiveCamera(45, 4 / 3, 0.01, 3000);
      this.resize();
      addEventListener('resize', () => this.resize());
      this.bindPointer(r.domElement);
    }

    list() { return this.app.active.kind === 'rover' ? ROVER_CAMS : BUGGY_CAMS; }
    setMode(m) {
      if (!this.list().includes(m)) m = 'chase';
      this.mode = m;
      this.app.bus.emit('camera', m);
    }
    cycle(dir = 1) { const L = this.list(); this.setMode(L[(L.indexOf(this.mode) + dir + L.length) % L.length]); }
    // показать прибор в окне PiP во время операции, если смотрим снаружи
    focusInstrument(name) { if (this.mode === 'chase') this.pip = name; }

    resize() {
      const r = this.app.renderer, w = innerWidth, h = innerHeight;
      r.setSize(w, h);
      const pr = r.getPixelRatio();
      this.rt.setSize(Math.floor(w * pr), Math.floor(h * pr));
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    bindPointer(el) {
      let drag = null;
      el.addEventListener('pointerdown', (e) => {
        drag = { x: e.clientX, y: e.clientY, moved: 0, button: e.button };
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        drag.x = e.clientX; drag.y = e.clientY;
        if (drag.moved < 4) return;
        el.classList.add('dragging');
        const cam = CAMS[this.mode];
        if (cam.mast && this.app.active.kind === 'rover') {
          // в камерах мачты мышь поворачивает саму мачту
          const R = this.app.rover, k = (this.camera.fov * PG.DEG) / innerHeight;
          R.setMast(R.mast.tPan - dx * k * 1.2, R.mast.tTilt - dy * k);
        } else if (this.mode === 'chase') {
          this.orbit.yaw -= dx * 0.005;
          this.orbit.pitch = PG.clamp(this.orbit.pitch + dy * 0.004, -0.05, 1.45);
          this.orbit.manualUntil = performance.now() + 4000;
        }
      });
      const up = (e) => {
        if (!drag) return;
        el.classList.remove('dragging');
        if (drag.moved < 4 && drag.button === 0) this.app.onClick(e.clientX, e.clientY);
        drag = null;
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', () => { drag = null; el.classList.remove('dragging'); });
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (this.mode === 'chase') this.orbit.dist = PG.clamp(this.orbit.dist * Math.exp(e.deltaY * 0.0012), 2.5, 60);
      }, { passive: false });
    }

    ray(x, y) {
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), this.camera);
      return rc;
    }

    placeCamera(cam, mode, dt) {
      const A = this.app.active;
      const def = CAMS[mode];
      cam.fov = def.fov;
      if (mode === 'chase') {
        const O = this.orbit, T = this.app.terrain;
        const focus = A.group.position.clone().add(new THREE.Vector3(0, A.kind === 'rover' ? 1.1 : 0.9, 0));
        if (!O.init) { O.target.copy(focus); O.init = true; O.dist = A.kind === 'rover' ? 7.5 : 8.5; }
        O.target.lerp(focus, 1 - Math.exp(-dt * (A.kind === 'buggy' ? 12 : 6)));
        // за машиной, если не крутили мышью
        if (performance.now() > O.manualUntil && A.speed > (A.kind === 'buggy' ? 2 : 0.01)) {
          O.yaw += PG.wrapAngle(A.heading() - O.yaw) * (1 - Math.exp(-dt * 1.8));
        }
        const d = O.dist * (A.kind === 'buggy' ? 1 + Math.min(0.5, Math.abs(A.speed) / 60) : 1);
        cam.position.set(
          O.target.x + Math.sin(O.yaw) * Math.cos(O.pitch) * d,
          O.target.y + Math.sin(O.pitch) * d,
          O.target.z + Math.cos(O.yaw) * Math.cos(O.pitch) * d);
        const gy = T.heightAt(cam.position.x, cam.position.z) + 0.4;
        if (cam.position.y < gy) cam.position.y = gy;
        cam.up.set(0, 1, 0);
        cam.lookAt(O.target);
        if (A.kind === 'buggy') cam.fov = def.fov + (A.rocketOn ? 14 : 0) * (A.flamePower || 0) + Math.min(10, Math.abs(A.speed) / 4);
      } else if (mode === 'hood') {
        const q = A.group.quaternion;
        cam.position.copy(A.group.position).add(new THREE.Vector3(0, 2.15, 3.3).applyQuaternion(q));   // над ракетой
        cam.up.set(0, 1, 0).applyQuaternion(q);
        cam.lookAt(A.group.position.clone().add(new THREE.Vector3(0, 0.9, -6).applyQuaternion(q)));
      } else {
        this.app.rover.mount(mode, cam);
      }
      cam.updateProjectionMatrix();
    }

    update(dt) {
      this.placeCamera(this.camera, this.mode, dt);
      if (this.pip) {
        const ops = this.app.ops;
        if (!ops.busy || this.mode !== 'chase') this.pip = null;
      }
    }

    // MAHLI сидит на турели: её же детали заслоняют кадр — на время съёмки прячем турель
    withoutTurret(mode, fn) {
      const T = this.app.rover.nodes.armTurret;
      if (mode !== 'mahli') return fn();
      T.visible = false;
      try { return fn(); } finally { T.visible = true; }
    }

    render(t) {
      const r = this.app.renderer, S = this.app.scene;
      const def = CAMS[this.mode];
      this.postMat.uniforms.uTime.value = t % 100;
      if (def.filter < 0) {
        r.setRenderTarget(null);
        r.render(S, this.camera);
      } else {
        r.setRenderTarget(this.rt);
        this.withoutTurret(this.mode, () => r.render(S, this.camera));
        this.post(this.rt, def.filter, this.camera.aspect);
      }
      if (this.pip) {
        const pd = CAMS[this.pip];
        this.placeCamera(this.pipCam, this.pip, 0);
        this.pipCam.aspect = 4 / 3; this.pipCam.updateProjectionMatrix();
        r.setRenderTarget(this.pipRT);
        this.withoutTurret(this.pip, () => r.render(S, this.pipCam));
        const w = 320, h = 240, x = innerWidth - w - 24, y = 96;
        r.setScissorTest(true);
        r.setViewport(x, innerHeight - y - h, w, h); r.setScissor(x, innerHeight - y - h, w, h);
        this.post(this.pipRT, Math.max(0, pd.filter), 4 / 3);
        r.setScissorTest(false);
        r.setViewport(0, 0, innerWidth, innerHeight);
        this.pipRect = { x, y, w, h, label: pd.label };
      } else this.pipRect = null;
    }
    post(rt, filter, aspect) {
      const r = this.app.renderer;
      this.postMat.uniforms.tDiffuse.value = rt.texture;
      this.postMat.uniforms.uMode.value = filter;
      this.postMat.uniforms.uAspect.value = aspect;
      r.setRenderTarget(null);
      r.render(this.postScene, this.postCam);
    }

    // Снимок прибора: временно меняем размер холста, рендерим и читаем JPEG.
    capture(mode, w, h, before) {
      const r = this.app.renderer, S = this.app.scene;
      const size = r.getSize(new THREE.Vector2()), pr = r.getPixelRatio();
      const cam = new THREE.PerspectiveCamera(45, w / h, 0.005, 3000);
      if (before) before(cam); else this.placeCamera(cam, mode, 0);
      cam.aspect = w / h; cam.updateProjectionMatrix();
      r.setPixelRatio(1); r.setSize(w, h, false);
      const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.HalfFloatType });
      r.setRenderTarget(rt); this.withoutTurret(mode, () => r.render(S, cam));
      this.post(rt, Math.max(0, CAMS[mode] ? CAMS[mode].filter : 0), w / h);
      const url = r.domElement.toDataURL('image/jpeg', 0.9);
      rt.dispose();
      r.setPixelRatio(pr); r.setSize(size.x, size.y, false);
      this.app.renderer.domElement.style.width = '100%'; this.app.renderer.domElement.style.height = '100%';
      return url;
    }
    // Селфи: камера на турели смотрит на ровер, рука скрыта (как на склеенных мозаиках).
    captureSelfie(w, h) {
      const R = this.app.rover, arm = [R.nodes.armUpper, R.nodes.armBase];
      arm.forEach((n) => { n.visible = false; });
      const url = this.capture('mastcam34', w, h, (cam) => {
        const tp = R.toolPoint(new THREE.Vector3());
        const c = R.group.localToWorld(new THREE.Vector3(0, 0.95, 0));
        cam.position.copy(tp).add(new THREE.Vector3(0, 0.25, 0));
        cam.fov = 70;
        cam.up.set(0, 1, 0);
        cam.lookAt(c);
      });
      arm.forEach((n) => { n.visible = true; });
      return url;
    }
  };
})(window.PG);
