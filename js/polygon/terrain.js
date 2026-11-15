'use strict';
// Процедурный тестовый полигон: красный песчаный рельеф с горками, кратером, трамплинами и камнями.
// Контракт поверхности (его же должна будет реализовать будущая реальная карта):
//   mesh, size, heightAt(x,z), normalAt(x,z,out), buildColliders(physics), pick(raycaster),
//   materialAt(x,z) → тип грунта, waterAt(x,z) → водородный эквивалент (для DAN).
(function (PG) {
  const ROCK_TYPES = {
    basalt:       { name: 'Базальт',              color: 0x3b3430, rough: 0.85 },
    mudstone:     { name: 'Аргиллит (Мюррей)',     color: 0x9a6a4f, rough: 0.95 },
    sandstone:    { name: 'Песчаник (Стимсон)',    color: 0x7d5a44, rough: 0.95 },
    conglomerate: { name: 'Конгломерат',          color: 0x806650, rough: 0.9 },
    sulfate:      { name: 'Сульфатная жила',       color: 0xd8cfc0, rough: 0.7 },
    meteorite:    { name: 'Железный метеорит',     color: 0x2a2624, rough: 0.35, metal: 0.8 },
  };
  PG.ROCK_TYPES = ROCK_TYPES;

  // Мелкая зернистость (мм–см) по мировым координатам: видна в MAHLI и вблизи, гаснет с расстоянием.
  const GRAIN_GLSL = `
    varying vec3 vGrainPos;
    float gHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float gNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(gHash(i), gHash(i + vec3(1,0,0)), f.x), mix(gHash(i + vec3(0,1,0)), gHash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(gHash(i + vec3(0,0,1)), gHash(i + vec3(1,0,1)), f.x), mix(gHash(i + vec3(0,1,1)), gHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
    float grain(vec3 p, float dist){
      float near = 1.0 - smoothstep(0.4, 4.0, dist), mid = 1.0 - smoothstep(3.0, 25.0, dist);
      float g = (gNoise(p * 900.0) - 0.5) * 0.45 * near + (gNoise(p * 160.0) - 0.5) * 0.35 * near
              + (gNoise(p * 28.0) - 0.5) * 0.25 * mid;
      float pebble = smoothstep(0.78, 0.86, gNoise(p * 60.0)) * near;
      return 1.0 + g - pebble * 0.25;
    }`;
  function addGrain(mat, strength) {
    const prev = mat.onBeforeCompile;
    mat.customProgramCacheKey = () => `grain${strength}${prev ? prev.toString().length : 0}`;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.vertexShader = 'varying vec3 vGrainPos;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 gw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          gw = instanceMatrix * gw;
        #endif
        vGrainPos = (modelMatrix * gw).xyz;`);
      sh.fragmentShader = GRAIN_GLSL + '\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(1.0, grain(vGrainPos, length(vGrainPos - cameraPosition)), ${strength.toFixed(2)});`);
    };
  }
  PG.addGrain = addGrain;

  PG.ProceduralTerrain = class {
    constructor({ size = 400, step = 1, seed = 4816 } = {}) {
      this.size = size;
      this.step = step;
      this.n = Math.round(size / step) + 1;
      this.half = size / 2;
      this.noise = new PG.Noise(seed);
      this.noise2 = new PG.Noise(seed + 17);
      this.rand = PG.rng(seed);
      this.heights = new Float32Array(this.n * this.n);
      this.rocks = [];
      this.rockMeshes = [];
      this.hills = [
        { x: 46, z: -62, r: 22, h: 7 }, { x: -78, z: -34, r: 32, h: 11 },
        { x: 96, z: 52, r: 18, h: 5 }, { x: -46, z: 92, r: 26, h: 6 },
        { x: 18, z: 70, r: 12, h: 3 }, { x: -110, z: 40, r: 20, h: 8 },
      ];
      this.crater = { x: 62, z: 14, r: 19 };
      this.ramps = [
        { x: -18, z: -46, len: 14, h: 2.6, w: 7 },
        { x: 30, z: -110, len: 18, h: 3.4, w: 8 },
        { x: -60, z: 30, len: 12, h: 2.0, w: 6 },
      ];
      // пологий заезд смотрит к центру полигона, обрыв — от него
      for (const r of this.ramps) r.dir = Math.atan2(r.x, r.z);
      this.outcrop = { x: -30, z: 34, r: 22 };   // плиты аргиллита — цели для бура
      this.generate();
    }

    rawHeight(x, z) {
      const N = this.noise, N2 = this.noise2;
      let h = 1.4 * N.fbm(x / 70, z / 70, 4);
      // дюны с гребнями
      const dune = 1 - Math.abs(N2.n2(x / 26 + 3.1, z / 40 - 1.7));
      h += 0.7 * dune * dune * (0.5 + 0.5 * N.n2(x / 90, z / 90));
      // мелкие неровности и эоловая рябь
      h += 0.22 * N2.fbm(x / 7, z / 7, 3);
      h += 0.05 * Math.sin((x * 0.8 + z * 0.6) * 1.6 + N.n2(x / 10, z / 10) * 3);
      for (const k of this.hills) {
        const d2 = ((x - k.x) ** 2 + (z - k.z) ** 2) / (k.r * k.r);
        h += k.h * Math.exp(-d2 * 2.2) * (1 + 0.12 * N.n2(x / 9, z / 9));
      }
      // кратер: чаша и вал
      const c = this.crater, dc = Math.hypot(x - c.x, z - c.z) / c.r;
      if (dc < 2.2) {
        const bowl = dc < 1 ? -3.6 * (1 - dc * dc) : 0;
        const rim = 1.8 * Math.exp(-((dc - 1) ** 2) * 18);
        const ejecta = dc > 1 ? 0.5 * Math.exp(-(dc - 1) * 2.5) : 0;
        h += bowl + rim + ejecta;
      }
      // трамплины для багги: пологий заезд и резкий обрыв
      for (const r of this.ramps) {
        const cs = Math.cos(r.dir), sn = Math.sin(r.dir);
        const lx = (x - r.x) * cs - (z - r.z) * sn;     // поперёк
        const lz = (x - r.x) * sn + (z - r.z) * cs;     // вдоль (−len … 0)
        if (lz < 0 && lz > -r.len && Math.abs(lx) < r.w) {
          const t = 1 + lz / r.len;
          const side = 1 - PG.clamp((Math.abs(lx) - r.w + 2) / 2, 0, 1);
          h += r.h * Math.sin(t * Math.PI / 2) ** 1.4 * side;
        } else if (lz >= 0 && lz < 1.5 && Math.abs(lx) < r.w) {
          const side = 1 - PG.clamp((Math.abs(lx) - r.w + 2) / 2, 0, 1);
          h += r.h * Math.max(0, 1 - lz / 1.5) ** 2 * side;
        }
      }
      // ровная площадка старта
      const ds = Math.hypot(x, z);
      if (ds < 22) {
        const k = PG.clamp((22 - ds) / 10, 0, 1);
        h = PG.lerp(h, 0.12 * N2.fbm(x / 7, z / 7, 2), k * k * (3 - 2 * k));
      }
      // края полигона: неровный вал (как стенка кратера), а не прямая стена
      const ang = Math.atan2(z, x);
      const rim = this.half - 48 + 14 * N.n2(Math.cos(ang) * 2.2 + 5, Math.sin(ang) * 2.2);
      const edge = Math.hypot(x, z) - rim;
      if (edge > 0) {
        const k = PG.clamp(edge / 70, 0, 1);
        h += 26 * k * k * (3 - 2 * k) * (0.7 + 0.6 * N2.fbm(x / 45, z / 45, 3)) + 3 * N.fbm(x / 12, z / 12, 2) * k;
      }
      return h;
    }

    generate() {
      const { n, step, half } = this;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) this.heights[j * n + i] = this.rawHeight(i * step - half, j * step - half);
      }
    }

    // Высота точно по треугольникам меша (диагональ ячейки — от (i,j) к (i+1,j+1)).
    heightAt(x, z) {
      const { n, step, half } = this;
      const fx = PG.clamp((x + half) / step, 0, n - 1.0001), fz = PG.clamp((z + half) / step, 0, n - 1.0001);
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
      const H = this.heights;
      const h00 = H[j * n + i], h10 = H[j * n + i + 1], h01 = H[(j + 1) * n + i], h11 = H[(j + 1) * n + i + 1];
      return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
    }

    normalAt(x, z, out) {
      const e = this.step * 0.5;
      const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
      const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
      return out.set(-dx, 2 * e, -dz).normalize();
    }

    materialAt(x, z) {
      const o = this.outcrop;
      if (Math.hypot(x - o.x, z - o.z) < o.r * 0.9) return 'mudstone';
      return 'soil';
    }

    // Водородный эквивалент воды под поверхностью, % масс. — «правда» для DAN.
    waterAt(x, z) {
      const o = this.outcrop;
      const clay = Math.exp(-((x - o.x) ** 2 + (z - o.z) ** 2) / (2 * 28 * 28));
      return PG.clamp(2.4 + 1.1 * this.noise2.fbm(x / 45 + 7, z / 45, 3) + 2.2 * clay, 1.2, 7);
    }

    buildMesh() {
      const { n, step, half } = this;
      const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), col = new Float32Array(n * n * 3);
      const c = new THREE.Color(), sand = new THREE.Color(), dark = new THREE.Color(), rock = new THREE.Color(), dust = new THREE.Color();
      sand.setRGB(0.66, 0.38, 0.22, THREE.SRGBColorSpace);
      dark.setRGB(0.30, 0.22, 0.18, THREE.SRGBColorSpace);
      rock.setRGB(0.72, 0.52, 0.38, THREE.SRGBColorSpace);
      dust.setRGB(0.78, 0.50, 0.30, THREE.SRGBColorSpace);
      const nrm = new THREE.Vector3();
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const k = j * n + i, x = i * step - half, z = j * step - half, h = this.heights[k];
          pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
          uv[k * 2] = x / 3; uv[k * 2 + 1] = z / 3;
          this.normalAt(x, z, nrm);
          const slope = 1 - nrm.y;
          const patch = PG.clamp(0.5 + 0.9 * this.noise.fbm(x / 34 + 11, z / 34 - 4, 3), 0, 1);
          c.copy(sand).lerp(dark, patch * 0.55);
          c.lerp(dust, PG.clamp(this.noise2.n2(x / 15, z / 15) * 0.6, 0, 0.35));
          c.lerp(rock, PG.clamp(slope * 4, 0, 0.7));
          const o = this.outcrop, dO = Math.hypot(x - o.x, z - o.z) / o.r;
          if (dO < 1) c.lerp(rock, (1 - dO) * 0.5);
          // впадины темнее, гребни светлее
          const cav = h - this.heightAt(x + 3, z) * 0.25 - this.heightAt(x - 3, z) * 0.25 - this.heightAt(x, z + 3) * 0.25 - this.heightAt(x, z - 3) * 0.25;
          c.multiplyScalar(PG.clamp(1 + cav * 0.5, 0.8, 1.15));
          col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
        }
      }
      const idx = new Uint32Array((n - 1) * (n - 1) * 6);
      let p = 0;
      for (let j = 0; j < n - 1; j++) {
        for (let i = 0; i < n - 1; i++) {
          const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
          // треугольники (a,e,b) и (a,d,e): диагональ a–e, как в heightAt
          idx[p++] = a; idx[p++] = e; idx[p++] = b;
          idx[p++] = a; idx[p++] = d; idx[p++] = e;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      this.positions = pos;
      this.indices = idx;

      const tex = makeSandTextures();
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, map: tex.color, normalMap: tex.normal, normalScale: new THREE.Vector2(0.9, 0.9),
        roughness: 0.96, metalness: 0,
      });
      // анти-тайлинг: второе чтение карты в другом масштабе
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D( map, vMapUv );
            vec4 s2 = texture2D( map, vMapUv * 0.137 + vec2(0.31, 0.71) );
            sampledDiffuseColor.rgb *= (0.62 + 0.5 * s2.rgb);
            diffuseColor *= sampledDiffuseColor;
          #endif`);
      };
      addGrain(mat, 0.8);
      this.mesh = new THREE.Mesh(g, mat);
      this.mesh.receiveShadow = true;
      this.mesh.name = 'terrain';
      return this.mesh;
    }

    buildColliders(physics) {
      const desc = RAPIER.ColliderDesc.trimesh(this.positions, this.indices).setFriction(0.9);
      this.collider = physics.world.createCollider(desc);
      this.collider.userData = { kind: 'ground' };
      for (const r of this.rocks) {
        if (r.radius < 0.14) continue;
        const pts = new Float32Array(r.hull);
        const cd = RAPIER.ColliderDesc.convexHull(pts);
        if (!cd) continue;
        cd.setFriction(0.8);
        r.collider = physics.world.createCollider(cd);
      }
    }

    // Камни: InstancedMesh по вариантам формы, у каждого экземпляра тип породы и коллайдер.
    scatterRocks() {
      const R = this.rand, variants = [];
      for (let v = 0; v < 6; v++) variants.push(makeRockGeometry(v * 13 + 5, v >= 4));
      const lists = variants.map(() => []);
      const place = (x, z, radius, type, flat) => {
        const vi = flat ? 4 + Math.floor(R() * 2) : Math.floor(R() * 4);
        const sy = flat ? 0.22 + R() * 0.12 : 0.55 + R() * 0.45;
        const s = new THREE.Vector3(radius * (0.8 + R() * 0.5), radius * sy, radius * (0.8 + R() * 0.5));
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 0.4, R() * Math.PI * 2, (R() - 0.5) * 0.4));
        const y = this.heightAt(x, z) + s.y * (flat ? 0.15 : 0.35) - 0.02;
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, s);
        const rock = { x, y, z, radius, type, variant: vi, index: lists[vi].length, matrix: m, dusty: true, marks: [] };
        lists[vi].push(rock);
        this.rocks.push(rock);
      };
      const typeByZone = (x, z) => {
        const o = this.outcrop;
        if (Math.hypot(x - o.x, z - o.z) < o.r) return R() < 0.12 ? 'sulfate' : 'mudstone';
        const t = R();
        return t < 0.45 ? 'basalt' : t < 0.75 ? 'sandstone' : 'conglomerate';
      };
      const free = (x, z, r) => Math.hypot(x, z) > 6 + r && Math.hypot(x, z) < this.half - 52;
      // мелочь
      for (let i = 0; i < 1400; i++) {
        const x = (R() - 0.5) * (this.size - 80), z = (R() - 0.5) * (this.size - 80), r = 0.03 + R() ** 3 * 0.14;
        if (free(x, z, r)) place(x, z, r, typeByZone(x, z), false);
      }
      // средние
      for (let i = 0; i < 260; i++) {
        const x = (R() - 0.5) * (this.size - 80), z = (R() - 0.5) * (this.size - 80), r = 0.15 + R() ** 2 * 0.45;
        if (free(x, z, r)) place(x, z, r, typeByZone(x, z), false);
      }
      // валуны (поодаль от старта и трамплинов)
      for (let i = 0; i < 26; i++) {
        const x = (R() - 0.5) * (this.size - 90), z = (R() - 0.5) * (this.size - 90), r = 0.7 + R() * 1.0;
        if (free(x, z, r) && Math.hypot(x, z) > 30) place(x, z, r, R() < 0.6 ? 'basalt' : 'sandstone', false);
      }
      // плиты аргиллита на обнажении
      const o = this.outcrop;
      for (let i = 0; i < 70; i++) {
        const a = R() * Math.PI * 2, d = Math.sqrt(R()) * o.r;
        place(o.x + Math.cos(a) * d, o.z + Math.sin(a) * d, 0.5 + R() * 0.9, R() < 0.1 ? 'sulfate' : 'mudstone', true);
      }
      // цели рядом со стартом: чтобы было что изучать, не уезжая
      place(4.2, -5.5, 0.32, 'basalt', false);
      place(-3.6, -6.4, 0.6, 'mudstone', true);
      place(2.0, -9.0, 0.26, 'sandstone', false);
      place(-6.5, -2.5, 0.45, 'conglomerate', false);
      place(8.5, -12.0, 0.38, 'meteorite', false);
      place(-1.2, -14.5, 0.55, 'sulfate', true);

      const tint = new THREE.Color();
      variants.forEach((geo, vi) => {
        const list = lists[vi];
        if (!list.length) return;
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, vertexColors: false });
        addGrain(mat, 1.0);
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        im.castShadow = true; im.receiveShadow = true;
        im.name = 'rocks' + vi;
        list.forEach((rock, i) => {
          im.setMatrixAt(i, rock.matrix);
          const t = ROCK_TYPES[rock.type];
          tint.setHex(t.color).multiplyScalar(0.85 + this.rand() * 0.3);
          im.setColorAt(i, tint);
          rock.mesh = im;
          // точки выпуклой оболочки в мировых координатах
          const p = geo.attributes.position, v = new THREE.Vector3(), hull = [];
          for (let k = 0; k < p.count; k += 7) { v.fromBufferAttribute(p, k).applyMatrix4(rock.matrix); hull.push(v.x, v.y, v.z); }
          rock.hull = hull;
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.userData.rocks = list;
        // металлический блеск только у метеорита: отдельный материал на экземпляре не задать, поэтому лёгкий общий блеск
        this.rockMeshes.push(im);
      });
      return this.rockMeshes;
    }

    // Луч → точка поверхности, нормаль и камень (если попали).
    pick(raycaster) {
      const hits = raycaster.intersectObjects([this.mesh, ...this.rockMeshes], false);
      if (!hits.length) return null;
      const h = hits[0];
      const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      if (h.object.isInstancedMesh) {
        const m = new THREE.Matrix4(); h.object.getMatrixAt(h.instanceId, m);
        normal.copy(h.face.normal).transformDirection(m).normalize();
        return { point: h.point.clone(), normal, rock: h.object.userData.rocks[h.instanceId], distance: h.distance };
      }
      return { point: h.point.clone(), normal, rock: null, distance: h.distance };
    }
  };

  PG.makeRockGeometry = makeRockGeometry;
  PG.makeSandTextures = makeSandTextures;

  function makeRockGeometry(seed, flat) {
    const g = new THREE.IcosahedronGeometry(1, 3);
    const N = new PG.Noise(seed), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      let d = 1 + 0.28 * N.fbm(v.x * 1.3 + 4, v.y * 1.3 + v.z * 0.7, 4) + 0.07 * N.n2(v.x * 6, v.z * 6 + v.y * 3);
      // сколы: срезаем гранями
      const facet = Math.max(0, N.n2(v.x * 2 + 9, v.y * 2 - v.z) - 0.25);
      d -= facet * 0.4;
      if (flat) { v.y = v.y > 0 ? v.y * 0.6 + 0.05 * Math.sin(v.x * 9) : v.y; }   // слоистая плита
      v.multiplyScalar(d);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }

  // Детальные текстуры песка: цвет (зерно, гравий) и нормали (мелкая галька, рябь).
  function makeSandTextures() {
    const S = 512, N = new PG.Noise(99), R = PG.rng(7);
    const h = new Float32Array(S * S);
    const tile = (x, y, f) => {           // бесшовный шум через смешивание 4 копий
      const u = x / S, v = y / S;
      const a = N.fbm(x * f, y * f, 3), b = N.fbm((x - S) * f, y * f, 3), c = N.fbm(x * f, (y - S) * f, 3), d = N.fbm((x - S) * f, (y - S) * f, 3);
      return PG.lerp(PG.lerp(a, b, u), PG.lerp(c, d, u), v);
    };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = tile(x, y, 1 / 48) * 0.6 + tile(x, y, 1 / 9) * 0.25;
    // гравий: мелкие бугорки
    for (let i = 0; i < 900; i++) {
      const cx = R() * S, cy = R() * S, r = 1.5 + R() * R() * 7, a = 0.3 + R() * 0.5;
      for (let y = -r - 1; y <= r + 1; y++) for (let x = -r - 1; x <= r + 1; x++) {
        const d = Math.hypot(x, y) / r; if (d >= 1) continue;
        const px = ((Math.floor(cx + x) % S) + S) % S, py = ((Math.floor(cy + y) % S) + S) % S;
        h[py * S + px] += a * Math.sqrt(1 - d * d) * 0.6;
      }
    }
    const cc = document.createElement('canvas'); cc.width = cc.height = S;
    const nc = document.createElement('canvas'); nc.width = nc.height = S;
    const ci = cc.getContext('2d').createImageData(S, S), ni = nc.getContext('2d').createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const k = y * S + x;
      const grain = (R() - 0.5) * 0.18;
      const l = PG.clamp(0.86 + h[k] * 0.22 + grain, 0.5, 1.1);
      const pebble = h[k] > 0.35 ? 0.82 : 1;
      ci.data[k * 4] = PG.clamp(l * 255 * pebble, 0, 255);
      ci.data[k * 4 + 1] = PG.clamp(l * 238 * pebble, 0, 255);
      ci.data[k * 4 + 2] = PG.clamp(l * 228 * pebble, 0, 255);
      ci.data[k * 4 + 3] = 255;
      const hx = h[y * S + ((x + 1) % S)] - h[y * S + ((x - 1 + S) % S)];
      const hy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
      const nv = new THREE.Vector3(-hx * 2.2, -hy * 2.2, 1).normalize();
      ni.data[k * 4] = (nv.x * 0.5 + 0.5) * 255; ni.data[k * 4 + 1] = (nv.y * 0.5 + 0.5) * 255;
      ni.data[k * 4 + 2] = (nv.z * 0.5 + 0.5) * 255; ni.data[k * 4 + 3] = 255;
    }
    cc.getContext('2d').putImageData(ci, 0, 0); nc.getContext('2d').putImageData(ni, 0, 0);
    const color = new THREE.CanvasTexture(cc), normal = new THREE.CanvasTexture(nc);
    for (const t of [color, normal]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    color.colorSpace = THREE.SRGBColorSpace;
    return { color, normal };
  }
})(window.PG);
