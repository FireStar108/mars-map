'use strict';
// Следы колёс (ленты на поверхности с рельефом протектора) и частицы пыли/пламени.
(function (PG) {
  const UP = new THREE.Vector3(0, 1, 0);

  // Рисунок протектора: высоты → цвет+прозрачность и карта нормалей.
  function treadTextures(kind) {
    const W = 128, H = kind === 'curiosity' ? 1024 : 256;
    const hgt = new Float32Array(W * H);
    const set = (x, y, v) => { if (x >= 0 && x < W) hgt[(((y % H) + H) % H) * W + x] = v; };
    if (kind === 'curiosity') {
      // 24 шевронных грунтозацепа на оборот (1.57 м)
      const n = 24, pitch = H / n;
      for (let g = 0; g < n; g++) {
        for (let x = 0; x < W; x++) {
          const u = Math.abs(x / W - 0.5);
          const y0 = Math.round(g * pitch + u * pitch * 0.9);
          for (let t = 0; t < 4; t++) set(x, y0 + t, -1);
        }
      }
      // азбука Морзе «J P L» отверстиями в ободе: J .---  P .--.  L .-..
      const code = ['.---', '.--.', '.-..'];
      let y = 30;
      for (const letter of code) {
        for (const s of letter) {
          const len = s === '.' ? 14 : 42;
          for (let yy = y; yy < y + len; yy++) for (let x = 38; x < 90; x++) set(x, yy, 1);
          y += len + 16;
        }
        y += 40;
      }
    } else {
      // шипованная покрышка багги
      for (let r = 0; r < 8; r++) {
        const y0 = r * (H / 8), off = (r % 2) * 20;
        for (let b = 0; b < 3; b++) {
          const x0 = 10 + off + b * 40;
          for (let yy = y0 + 4; yy < y0 + 22; yy++) for (let x = x0; x < x0 + 26; x++) set(x, yy, -1);
        }
      }
    }
    // размытие высот
    const blur = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx; if (xx < 0 || xx >= W) continue;
        s += hgt[(((y + dy) % H + H) % H) * W + xx]; c++;
      }
      blur[y * W + x] = s / c;
    }
    const cc = document.createElement('canvas'); cc.width = W; cc.height = H;
    const nc = document.createElement('canvas'); nc.width = W; nc.height = H;
    const ci = cc.getContext('2d').createImageData(W, H), ni = nc.getContext('2d').createImageData(W, H);
    const R = PG.rng(kind.length * 31);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x, h = blur[k];
      const edge = Math.min(x, W - 1 - x) / (W * 0.12);
      const a = PG.clamp(edge, 0, 1);
      const shade = 0.78 + h * 0.18 + (R() - 0.5) * 0.08;
      ci.data[k * 4] = 150 * shade; ci.data[k * 4 + 1] = 92 * shade; ci.data[k * 4 + 2] = 62 * shade;
      ci.data[k * 4 + 3] = 255 * a * 0.8;
      const hx = blur[y * W + Math.min(W - 1, x + 1)] - blur[y * W + Math.max(0, x - 1)];
      const hy = blur[((y + 1) % H) * W + x] - blur[((y - 1 + H) % H) * W + x];
      // края колеи — бортики
      const rim = x < W * 0.1 ? 1 : x > W * 0.9 ? -1 : 0;
      const nv = new THREE.Vector3(-hx * 1.6 + rim * 0.6, -hy * 1.6, 1).normalize();
      ni.data[k * 4] = (nv.x * 0.5 + 0.5) * 255; ni.data[k * 4 + 1] = (nv.y * 0.5 + 0.5) * 255;
      ni.data[k * 4 + 2] = (nv.z * 0.5 + 0.5) * 255; ni.data[k * 4 + 3] = 255;
    }
    cc.getContext('2d').putImageData(ci, 0, 0); nc.getContext('2d').putImageData(ni, 0, 0);
    const map = new THREE.CanvasTexture(cc), normal = new THREE.CanvasTexture(nc);
    map.colorSpace = THREE.SRGBColorSpace;
    for (const t of [map, normal]) { t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    return { map, normal };
  }

  class Trail {
    constructor(scene, terrain, material, width, patternLen, maxSeg) {
      this.terrain = terrain; this.width = width; this.patternLen = patternLen; this.maxSeg = maxSeg;
      this.pos = new Float32Array(maxSeg * 4 * 3);
      this.uv = new Float32Array(maxSeg * 4 * 2);
      const idx = new Uint32Array(maxSeg * 6);
      for (let s = 0; s < maxSeg; s++) {
        const b = s * 4;
        idx.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], s * 6);   // лицом вверх
      }
      const g = new THREE.BufferGeometry();
      this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
      this.uvAttr = new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', this.posAttr);
      g.setAttribute('uv', this.uvAttr);
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(maxSeg * 12).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.setDrawRange(0, 0);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      this.mesh = new THREE.Mesh(g, material);
      this.mesh.frustumCulled = false;
      this.mesh.receiveShadow = true;
      this.mesh.renderOrder = 1;
      scene.add(this.mesh);
      this.count = 0;
      this.last = null;
      this.lastL = new THREE.Vector3(); this.lastR = new THREE.Vector3();
      this.v = 0;
      this._side = new THREE.Vector3(); this._d = new THREE.Vector3();
    }
    break() { this.last = null; }
    edge(out, p, side, sign) {
      out.copy(p).addScaledVector(side, sign);
      out.y = this.terrain.heightAt(out.x, out.z) + 0.012;
      return out;
    }
    push(p, minStep) {
      const t = this.terrain;
      if (Math.abs(p.y - t.heightAt(p.x, p.z)) > 0.08) { this.last = null; return; }   // на камне следа нет
      if (!this.last) {
        this.last = p.clone();
        this._pendingFirst = true;
        return;
      }
      const d = this._d.subVectors(p, this.last); d.y = 0;
      const dist = d.length();
      if (dist < minStep) return;
      if (dist > 3) { this.last.copy(p); this._pendingFirst = true; return; }
      d.divideScalar(dist);
      const side = this._side.crossVectors(UP, d).multiplyScalar(this.width / 2);
      if (this._pendingFirst) {
        this.edge(this.lastL, this.last, side, 1);
        this.edge(this.lastR, this.last, side, -1);
        this._pendingFirst = false;
      }
      const L = this.edge(new THREE.Vector3(), p, side, 1), Rr = this.edge(new THREE.Vector3(), p, side, -1);
      const s = this.count % this.maxSeg, o = s * 12, u = s * 8;
      const v1 = this.v + dist / this.patternLen;
      this.pos.set([this.lastL.x, this.lastL.y, this.lastL.z, this.lastR.x, this.lastR.y, this.lastR.z,
        L.x, L.y, L.z, Rr.x, Rr.y, Rr.z], o);
      this.uv.set([0, this.v, 1, this.v, 0, v1, 1, v1], u);
      this.posAttr.addUpdateRange(o, 12); this.posAttr.needsUpdate = true;
      this.uvAttr.addUpdateRange(u, 8); this.uvAttr.needsUpdate = true;
      this.count++;
      this.mesh.geometry.setDrawRange(0, Math.min(this.count, this.maxSeg) * 6);
      this.v = v1 % 1000;
      this.lastL.copy(L); this.lastR.copy(Rr); this.last.copy(p);
    }
  }

  PG.Tracks = class {
    constructor(scene, terrain) {
      this.scene = scene; this.terrain = terrain;
      this.materials = {};
      for (const kind of ['curiosity', 'buggy']) {
        const t = treadTextures(kind);
        this.materials[kind] = new THREE.MeshStandardMaterial({
          map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(2.2, 2.2),
          transparent: true, depthWrite: false, roughness: 1, metalness: 0,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
        });
      }
    }
    // patternLen — длина рисунка вдоль колеи (для Curiosity = длина окружности колеса)
    trail(kind, width, patternLen, maxSeg = 4000) {
      return new Trail(this.scene, this.terrain, this.materials[kind], width, patternLen, maxSeg);
    }
  };

  // Пул частиц: пыль (обычное смешивание) или пламя (аддитивное).
  PG.Particles = class {
    constructor(scene, { max = 2000, additive = false, gravity = 0.25, drag = 0.6, color = 0xc98a5e } = {}) {
      this.max = max; this.gravity = gravity; this.drag = drag;
      this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
      this.life = new Float32Array(max); this.age = new Float32Array(max); this.size = new Float32Array(max);
      this.alpha = new Float32Array(max); this.grow = new Float32Array(max);
      const g = new THREE.BufferGeometry();
      this.pa = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage);
      this.sa = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
      this.aa = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', this.pa); g.setAttribute('size', this.sa); g.setAttribute('alpha', this.aa);
      this.mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) }, uScale: { value: 600 }, uHot: { value: additive ? 1 : 0 } },
        vertexShader: `
          attribute float size; attribute float alpha; varying float vA; uniform float uScale;
          void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
            gl_PointSize = size * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `
          uniform vec3 uColor; uniform float uHot; varying float vA;
          void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
            float s = smoothstep(0.5, 0.0, d);
            vec3 col = uHot > 0.5 ? mix(uColor, vec3(1.0, 0.95, 0.8), s * s * vA) : uColor;
            gl_FragColor = vec4(col, s * vA); }`,
        transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.points = new THREE.Points(g, this.mat);
      this.points.frustumCulled = false;
      this.points.renderOrder = 2;
      scene.add(this.points);
      this.cursor = 0;
      for (let i = 0; i < max; i++) this.age[i] = this.life[i] = 1;
    }
    emit(x, y, z, vx, vy, vz, size, life, grow = 1.5) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
      this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
      this.size[i] = size; this.life[i] = life; this.age[i] = 0; this.grow[i] = grow;
    }
    update(dt) {
      const k = Math.exp(-this.drag * dt);
      for (let i = 0; i < this.max; i++) {
        if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; continue; }
        this.age[i] += dt;
        const t = this.age[i] / this.life[i];
        this.v[i * 3] *= k; this.v[i * 3 + 2] *= k; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - PG.G_MARS * this.gravity * dt;
        this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
        this.size[i] *= 1 + this.grow[i] * dt;
        this.alpha[i] = (1 - t) * Math.min(1, t * 8) * 0.8;
      }
      this.pa.needsUpdate = this.sa.needsUpdate = this.aa.needsUpdate = true;
    }
  };
})(window.PG);
