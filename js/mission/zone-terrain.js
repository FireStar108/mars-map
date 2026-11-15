'use strict';
// Real terrain of one Marswalk zone: HiRISE stereo DTM (1 m) draped with the HiRISE orthoimage (25 cm),
// plus a coarser 8 m ring around it for the horizon. Implements the polygon's surface contract:
//   mesh, size, heightAt(x,z), normalAt(x,z,out), buildColliders(physics), pick(raycaster),
//   materialAt(x,z), waterAt(x,z).
// World frame: +X = east, −Z = north, Y = up, metres; the origin is the zone centre.
(function (PG) {
  const b64 = (s) => new Uint8Array(PG.base64ToBuffer(s));

  function decodeGrid(g) {
    const raw = new Uint16Array(b64(g.h).buffer);
    const out = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = g.hMin + raw[i] * g.hScale;
    return out;
  }

  // Grayscale HiRISE RED → Mars colours. Two tones taken from Mastcam scenes of Mount Sharp.
  const COLORIZE = `
    vec3 marsTone(float l) {
      vec3 dark = vec3(0.10, 0.065, 0.045), mid = vec3(0.36, 0.25, 0.17), hi = vec3(0.65, 0.48, 0.34);
      return l < 0.5 ? mix(dark, mid, l * 2.0) : mix(mid, hi, (l - 0.5) * 2.0);
    }`;

  PG.ZoneTerrain = class {
    constructor(data) {
      this.data = data;
      const N = data.near;
      this.size = N.size;
      this.n = N.n;
      this.step = N.size / (N.n - 1);
      this.half = N.size / 2;
      this.heights = decodeGrid(N);
      this.hMin = N.hMin;
      this.far = data.far;
      this.farHeights = decodeGrid(data.far);
      this.farStep = data.far.size / (data.far.n - 1);
      this.farHalf = data.far.size / 2;
      this.rocks = [];
      this.rockMeshes = [];
      this.rand = PG.rng(4816);
      this.noise = new PG.Noise(77);
      this.buildDerived();
    }

    /* ---------- sampling ---------- */
    heightAt(x, z) {
      const { n, step, half } = this;
      if (Math.abs(x) > half || Math.abs(z) > half) return this.farHeightAt(x, z);
      const fx = PG.clamp((x + half) / step, 0, n - 1.0001), fz = PG.clamp((z + half) / step, 0, n - 1.0001);
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
      const H = this.heights;
      const h00 = H[j * n + i], h10 = H[j * n + i + 1], h01 = H[(j + 1) * n + i], h11 = H[(j + 1) * n + i + 1];
      return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
    }
    farHeightAt(x, z) {
      const n = this.far.n, s = this.farStep, half = this.farHalf;
      const fx = PG.clamp((x + half) / s, 0, n - 1.0001), fz = PG.clamp((z + half) / s, 0, n - 1.0001);
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, H = this.farHeights;
      const a = H[j * n + i], b = H[j * n + i + 1], c = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    }
    normalAt(x, z, out, e = this.step * 0.5) {
      const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
      const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
      return out.set(-dx, 2 * e, -dz).normalize();
    }
    inside(x, z, margin = 0) { return Math.abs(x) < this.half - margin && Math.abs(z) < this.half - margin; }

    // Grids derived on load: slope (deg, from a 3 m baseline), roughness (RMS of 1 m heights about the local
    // plane in a 5×5 m window) at 2 m, plus the precomputed sky-view and sand masks from the build script.
    buildDerived() {
      const D = this.data.layers;
      this.lg = { n: D.n, step: this.size / (D.n - 1) };
      this.svf = b64(D.svf);
      this.sand = b64(D.sand);
      const ln = D.n, ls = this.lg.step;
      this.rough = new Float32Array(ln * ln);
      this.slope = new Float32Array(ln * ln);
      const nrm = new THREE.Vector3();
      for (let j = 0; j < ln; j++) {
        for (let i = 0; i < ln; i++) {
          const x = i * ls - this.half, z = j * ls - this.half;
          this.normalAt(x, z, nrm, 1.5);
          this.slope[j * ln + i] = Math.acos(PG.clamp(nrm.y, -1, 1)) / PG.DEG;
          // residual RMS about the plane through x,z with that normal
          const h0 = this.heightAt(x, z), gx = -nrm.x / nrm.y, gz = -nrm.z / nrm.y;
          let s = 0, c = 0;
          for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
            const r = this.heightAt(x + dx, z + dz) - (h0 + gx * dx + gz * dz);
            s += r * r; c++;
          }
          this.rough[j * ln + i] = Math.sqrt(s / c);
        }
      }
    }
    layerAt(arr, x, z, scale = 1) {
      const n = this.lg.n, s = this.lg.step;
      const fx = PG.clamp((x + this.half) / s, 0, n - 1.0001), fz = PG.clamp((z + this.half) / s, 0, n - 1.0001);
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
      const a = arr[j * n + i], b = arr[j * n + i + 1], c = arr[(j + 1) * n + i], d = arr[(j + 1) * n + i + 1];
      return ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v) * scale;
    }
    slopeAt(x, z) { return this.layerAt(this.slope, x, z); }
    roughAt(x, z) { return this.layerAt(this.rough, x, z); }
    svfAt(x, z) { return this.layerAt(this.svf, x, z, 1 / 255); }
    sandAt(x, z) { return this.layerAt(this.sand, x, z, 1 / 255); }

    materialAt(x, z) { return this.sandAt(x, z) > 0.5 ? 'sand' : this.roughAt(x, z) > 0.12 ? 'bedrock' : 'soil'; }
    // Hydrogen equivalent of water, wt% (for DAN-style readouts): DAN at Gale reads ~2–5 %.
    waterAt(x, z) { return PG.clamp(2.6 + 1.2 * this.noise.fbm(x / 60 + 7, z / 60, 3) + (this.sandAt(x, z) > 0.5 ? -0.6 : 0.4), 1.2, 6); }

    /* ---------- meshes ---------- */
    buildMesh(renderer) {
      const group = new THREE.Group();
      const loader = new THREE.TextureLoader();
      const aniso = renderer.capabilities.getMaxAnisotropy();
      const ortho = loader.load(this.data.near.ortho);
      ortho.colorSpace = THREE.NoColorSpace;
      ortho.anisotropy = aniso;
      const farOrtho = loader.load(this.data.far.ortho);
      farOrtho.colorSpace = THREE.NoColorSpace;
      farOrtho.anisotropy = aniso;
      const sandTex = PG.makeSandTextures();

      const near = this.gridGeometry(this.n, this.step, this.half, (k) => this.heights[k]);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, normalMap: sandTex.normal, normalScale: new THREE.Vector2(0.6, 0.6) });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uOrtho = { value: ortho };
        sh.uniforms.uDetail = { value: sandTex.color };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vZoneUv; varying vec3 vWp;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\nvZoneUv = uv;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>\nuniform sampler2D uOrtho; uniform sampler2D uDetail; varying vec2 vZoneUv; varying vec3 vWp;\n${COLORIZE}`)
          .replace('#include <map_fragment>', `
            float lum = texture2D(uOrtho, vZoneUv).r;
            vec3 base = marsTone(lum);
            float dist = length(vWp - cameraPosition);
            vec3 det = texture2D(uDetail, vWp.xz / 3.0).rgb;
            vec3 det2 = texture2D(uDetail, vWp.xz * 0.37 + 0.31).rgb;
            float near = 1.0 - smoothstep(6.0, 60.0, dist);
            base *= mix(vec3(1.0), det * (0.62 + 0.5 * det2), 0.35 * near);
            diffuseColor.rgb *= base * 1.25;`)
          // detail normals fade with distance so the orbital image dominates further away
          .replace('#include <normal_fragment_maps>', `
            vec3 mapN = texture2D( normalMap, vWp.xz / 3.0 ).xyz * 2.0 - 1.0;
            mapN.xy *= normalScale * (1.0 - smoothstep(4.0, 40.0, length(vWp - cameraPosition)));
            normal = normalize( tbn * mapN );`);
      };
      mat.customProgramCacheKey = () => 'zone-near';
      PG.addGrain(mat, 0.6);
      const nm = new THREE.Mesh(near, mat);
      nm.receiveShadow = true;
      nm.name = 'terrain';
      group.add(nm);
      this.mesh = nm;

      // horizon ring: the 8 m grid, dropped a little so the near mesh always wins where both exist
      const F = this.far;
      const fg = this.gridGeometry(F.n, this.farStep, this.farHalf, (k) => this.farHeights[k] - 0.6);
      const fmat = new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0 });
      fmat.onBeforeCompile = (sh) => {
        sh.uniforms.uOrtho = { value: farOrtho };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vZoneUv;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\nvZoneUv = uv;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>\nuniform sampler2D uOrtho; varying vec2 vZoneUv;\n${COLORIZE}`)
          .replace('#include <map_fragment>', 'diffuseColor.rgb *= marsTone(texture2D(uOrtho, vZoneUv).r) * 1.25;');
      };
      fmat.customProgramCacheKey = () => 'zone-far';
      const fm = new THREE.Mesh(fg, fmat);
      fm.receiveShadow = false;
      group.add(fm);
      this.farMesh = fm;
      return group;
    }

    gridGeometry(n, step, half, hOf) {
      const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const k = j * n + i;
          pos[k * 3] = i * step - half; pos[k * 3 + 1] = hOf(k); pos[k * 3 + 2] = j * step - half;
          uv[k * 2] = i / (n - 1); uv[k * 2 + 1] = 1 - j / (n - 1);     // texture row 0 = north
        }
      }
      const idx = new Uint32Array((n - 1) * (n - 1) * 6);
      let p = 0;
      for (let j = 0; j < n - 1; j++) {
        for (let i = 0; i < n - 1; i++) {
          const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
          idx[p++] = a; idx[p++] = e; idx[p++] = b;      // diagonal a–e, as in heightAt
          idx[p++] = a; idx[p++] = d; idx[p++] = e;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      return g;
    }

    /* ---------- physics ---------- */
    // Rapier heightfield: (nrows+1)×(ncols+1) heights in column-major order, rows along Z, columns along X.
    buildColliders(physics) {
      const n = this.n, H = this.heights, hf = new Float32Array(n * n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hf[i * n + j] = H[j * n + i];
      const desc = RAPIER.ColliderDesc.heightfield(n - 1, n - 1, hf, { x: this.size, y: 1, z: this.size }).setFriction(0.9);
      this.collider = physics.world.createCollider(desc);
      for (const r of this.rocks) {
        if (r.radius < 0.22) continue;
        const cd = RAPIER.ColliderDesc.convexHull(new Float32Array(r.hull));
        if (!cd) continue;
        cd.setFriction(0.8);
        r.collider = physics.world.createCollider(cd);
      }
    }

    // Rocks follow the DTM: dense where the 1 m surface is rough, none on sand. Boulders seen by HiRISE are
    // ≥1 m; smaller ones are statistically placed (rock abundance rises with roughness).
    scatterRocks(keepClear = []) {
      const R = this.rand, variants = [];
      for (let v = 0; v < 6; v++) variants.push(PG.makeRockGeometry(v * 13 + 5, v >= 4));
      const lists = variants.map(() => []);
      const clear = (x, z, r) => keepClear.every((c) => Math.hypot(x - c.x, z - c.z) > c.r + r);
      const place = (x, z, radius, flat) => {
        const vi = flat ? 4 + Math.floor(R() * 2) : Math.floor(R() * 4);
        const sy = flat ? 0.22 + R() * 0.12 : 0.5 + R() * 0.45;
        const s = new THREE.Vector3(radius * (0.8 + R() * 0.5), radius * sy, radius * (0.8 + R() * 0.5));
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 0.4, R() * Math.PI * 2, (R() - 0.5) * 0.4));
        const y = this.heightAt(x, z) + s.y * (flat ? 0.15 : 0.3) - 0.03;
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, s);
        const type = flat ? 'mudstone' : R() < 0.5 ? 'sandstone' : 'mudstone';
        const rock = { x, y, z, radius, type, variant: vi, index: lists[vi].length, matrix: m, dusty: true, marks: [] };
        lists[vi].push(rock);
        this.rocks.push(rock);
      };
      const lim = this.half - 4;
      for (let i = 0; i < 60000 && this.rocks.length < 9000; i++) {
        const x = (R() * 2 - 1) * lim, z = (R() * 2 - 1) * lim;
        const rough = this.roughAt(x, z), sand = this.sandAt(x, z);
        const p = PG.clamp((rough - 0.02) * 6, 0.02, 1) * (1 - sand);
        if (R() > p) continue;
        const big = R() < 0.06 * p;
        const r = big ? 0.35 + R() * 0.6 : 0.04 + R() ** 3 * 0.25;
        if (!clear(x, z, r)) continue;
        place(x, z, r, rough > 0.08 && R() < 0.35);
      }
      const tint = new THREE.Color();
      variants.forEach((geo, vi) => {
        const list = lists[vi];
        if (!list.length) return;
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
        PG.addGrain(mat, 1.0);
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        im.castShadow = true; im.receiveShadow = true;
        list.forEach((rock, i) => {
          im.setMatrixAt(i, rock.matrix);
          tint.setHex(PG.ROCK_TYPES[rock.type].color).multiplyScalar(0.85 + R() * 0.3);
          im.setColorAt(i, tint);
          rock.mesh = im;
          const p = geo.attributes.position, v = new THREE.Vector3(), hull = [];
          for (let k = 0; k < p.count; k += 7) { v.fromBufferAttribute(p, k).applyMatrix4(rock.matrix); hull.push(v.x, v.y, v.z); }
          rock.hull = hull;
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.userData.rocks = list;
        this.rockMeshes.push(im);
      });
      return this.rockMeshes;
    }

    // Ray → surface point: march the heightfield (raycasting a million triangles is too slow).
    pick(raycaster) {
      const o = raycaster.ray.origin, d = raycaster.ray.direction;
      let t = 0, prev = o.y - this.heightAt(o.x, o.z);
      if (prev < 0) return null;
      for (let i = 0; i < 4000 && t < 3000; i++) {
        const stepLen = Math.max(0.05, prev * 0.5);
        t += stepLen;
        const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
        const gap = y - this.heightAt(x, z);
        if (gap <= 0) {
          let a = t - stepLen, b = t;
          for (let k = 0; k < 20; k++) {
            const m = (a + b) / 2;
            const g = o.y + d.y * m - this.heightAt(o.x + d.x * m, o.z + d.z * m);
            if (g > 0) a = m; else b = m;
          }
          const point = new THREE.Vector3(o.x + d.x * b, 0, o.z + d.z * b);
          point.y = this.heightAt(point.x, point.z);
          return { point, normal: this.normalAt(point.x, point.z, new THREE.Vector3()), rock: null, distance: b };
        }
        prev = gap;
      }
      return null;
    }
  };
})(window.PG);
