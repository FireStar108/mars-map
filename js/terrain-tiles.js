/* View-dependent HRSC/MOLA relief, loaded locally in small reusable image tiles.
 * No full-resolution planet mesh or 11 GB browser allocation is needed.
 */
(function (root) {
  "use strict";
  const pending = new Map(),
    cache = new Map();
  const keyOf = (z, x, y) => `${z}/${x}_${y}`;
  function receive(z, x, y, source) {
    const task = pending.get(keyOf(z, x, y));
    if (!task) return;
    const image = new Image();
    image.onload = () => task.resolve(image);
    image.onerror = () =>
      task.reject(new Error("Relief image could not be decoded"));
    image.src = source;
  }
  function getTile(z, x, y) {
    const key = keyOf(z, x, y);
    if (cache.has(key)) {
      const image = cache.get(key);
      cache.delete(key);
      cache.set(key, image);
      return Promise.resolve(image);
    }
    if (pending.has(key)) return pending.get(key).promise;
    let script = null;
    let resolve, reject;
    const promise = new Promise((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    pending.set(key, { resolve, reject, promise });
    const timer = setTimeout(
      () => reject(new Error(`Relief tile timed out: ${key}`)),
      15000,
    );
    if (location.protocol !== "file:" && root.MARS_HRSC?.webFormat === "webp") {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Missing relief tile ${key}`));
      image.src = `assets/global/hrsc/${key}.webp`;
    } else {
      script = document.createElement("script");
      script.src = `assets/global/hrsc/${key}.js`;
      script.onerror = () => reject(new Error(`Missing relief tile ${key}`));
      document.head.append(script);
    }
    return promise
      .then((image) => {
        cache.set(key, image);
        while (cache.size > 36) cache.delete(cache.keys().next().value);
        return image;
      })
      .finally(() => {
        clearTimeout(timer);
        pending.delete(key);
        script?.remove();
      });
  }
  function create({ THREE, camera, renderer, material, markDirty }) {
    const canvas = document.createElement("canvas"),
      context = canvas.getContext("2d");
    function canvasTexture() {
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      return t;
    }
    let texture = canvasTexture();
    const uniforms = {
      reliefDetail: { value: texture },
      reliefBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
      reliefReady: { value: 0 },
    };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader =
        `uniform sampler2D reliefDetail; uniform vec4 reliefBounds; uniform float reliefReady;\n` +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `
        #include <map_fragment>
        vec2 detailUv=vec2(mod(vMapUv.x-reliefBounds.x+1.0,1.0)/reliefBounds.z,
          (vMapUv.y-reliefBounds.y)/reliefBounds.w);
        if(reliefReady>0.5 && detailUv.x>=0.0 && detailUv.x<=1.0 && detailUv.y>=0.0 && detailUv.y<=1.0)
          diffuseColor.rgb = diffuse * texture2D(reliefDetail,detailUv).rgb;
      `,
      );
    };
    material.customProgramCacheKey = () => "hrsc-relief-tiles-v1";
    const state = {
      enabled: true,
      level: -1,
      tileCount: 0,
      loading: false,
      error: null,
      requests: 0,
    };
    let timer = 0,
      generation = 0,
      previous = "";
    function extent() {
      const centre =
        (Math.atan2(-camera.position.z, camera.position.x) * 180) / Math.PI;
      const points = [],
        ray = new THREE.Raycaster();
      for (const y of [-1, -0.5, 0, 0.5, 1])
        for (const x of [-1, -0.5, 0, 0.5, 1]) {
          ray.setFromCamera({ x, y }, camera);
          const o = ray.ray.origin,
            d = ray.ray.direction,
            dot = o.dot(d);
          const discriminant = dot * dot - o.lengthSq() + 1;
          if (discriminant < 0) continue;
          const p = d
            .clone()
            .multiplyScalar(-dot - Math.sqrt(discriminant))
            .add(o)
            .normalize();
          const lon = (Math.atan2(-p.z, p.x) * 180) / Math.PI;
          const delta = ((lon - centre + 540) % 360) - 180;
          points.push({
            lat: (Math.asin(p.y) * 180) / Math.PI,
            lon: centre + delta,
          });
        }
      if (!points.length) return null;
      const west = Math.min(...points.map((p) => p.lon)) - 0.3;
      const east = Math.max(...points.map((p) => p.lon)) + 0.3;
      const south = Math.max(-90, Math.min(...points.map((p) => p.lat)) - 0.3);
      const north = Math.min(90, Math.max(...points.map((p) => p.lat)) + 0.3);
      let level = Math.min(
        MARS_HRSC.maxLevel,
        Math.max(
          1,
          Math.ceil(
            Math.log2(
              (innerHeight * 1.5 * 180) /
                (MARS_HRSC.tileSize * Math.max(1, north - south)),
            ),
          ),
        ),
      );
      let bounds;
      do {
        const nx = 2 ** (level + 1),
          ny = 2 ** level;
        const x0 = Math.floor(((west + 180) / 360) * nx);
        const x1 = Math.min(x0 + nx - 1, Math.floor(((east + 180) / 360) * nx));
        const y0 = Math.max(0, Math.floor(((90 - north) / 180) * ny));
        const y1 = Math.min(ny - 1, Math.floor(((90 - south) / 180) * ny));
        bounds = { level, nx, ny, x0, x1, y0, y1 };
        if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 32) break;
      } while (--level >= 1);
      return bounds;
    }
    async function refresh() {
      if (!state.enabled || !root.MARS_HRSC) return;
      if ((camera.position.length() - 1) * 3396.19 > 6000) {
        generation++;
        previous = "";
        state.level = -1;
        state.loading = false;
        uniforms.reliefReady.value = 0;
        markDirty();
        return;
      }
      const b = extent();
      if (!b) return;
      const signature = JSON.stringify(b);
      if (signature === previous) return;
      previous = signature;
      const token = ++generation;
      state.loading = true;
      state.error = null;
      const jobs = [];
      for (let y = b.y0; y <= b.y1; y++)
        for (let x = b.x0; x <= b.x1; x++) jobs.push({ x, y });
      try {
        let index = 0;
        const images = new Map();
        await Promise.all(
          Array.from({ length: Math.min(4, jobs.length) }, async () => {
            while (index < jobs.length && token === generation) {
              const p = jobs[index++];
              state.requests++;
              images.set(
                p,
                await getTile(b.level, ((p.x % b.nx) + b.nx) % b.nx, p.y),
              );
            }
          }),
        );
        if (token !== generation || !state.enabled) return;
        const cols = b.x1 - b.x0 + 1,
          rows = b.y1 - b.y0 + 1;
        const size = Math.min(
          MARS_HRSC.tileSize,
          Math.floor(
            Math.min(4096, renderer.capabilities.maxTextureSize) /
              Math.max(cols, rows),
          ),
        );
        canvas.width = cols * size;
        canvas.height = rows * size;
        for (const p of jobs)
          context.drawImage(
            images.get(p),
            (p.x - b.x0) * size,
            (p.y - b.y0) * size,
            size,
            size,
          );
        uniforms.reliefBounds.value.set(
          b.x0 / b.nx,
          1 - (b.y1 + 1) / b.ny,
          cols / b.nx,
          rows / b.ny,
        );
        // WebGL2 immutable texture storage cannot be resized in place.
        // Replace it after drawing the new-size mosaic and free the old allocation.
        const oldTexture = texture;
        texture = canvasTexture();
        uniforms.reliefDetail.value = texture;
        oldTexture.dispose();
        uniforms.reliefReady.value = 1;
        state.level = b.level;
        state.tileCount = jobs.length;
        state.loading = false;
        markDirty();
      } catch (error) {
        if (token !== generation) return;
        state.error = error.message;
        state.loading = false;
        previous = "";
        // Keep the complete lower-resolution map visible if a local tile is absent.
        console.warn(error.message);
        markDirty();
      }
    }
    return {
      state,
      schedule() {
        clearTimeout(timer);
        timer = setTimeout(refresh, 140);
      },
      setEnabled(enabled) {
        state.enabled = enabled;
        generation++;
        previous = "";
        clearTimeout(timer);
        if (enabled) timer = setTimeout(refresh, 0);
      },
      get cacheSize() {
        return cache.size;
      },
    };
  }
  root.MarsTerrainTiles = { create, receive };
})(window);
