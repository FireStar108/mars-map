/* One selected landform only. The reveal is clipped to its actual bundled polygon.
 * Rendering resolution is independent of the source contour's scientific resolution.
 */
(function (root) {
  "use strict";
  function create({ THREE, planet, terrainGeometry, maxTextureSize = 2048 }) {
    const resolution = Math.min(2048, maxTextureSize);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = resolution;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        mask: { value: texture },
        centre: { value: new THREE.Vector3() },
        east: { value: new THREE.Vector3() },
        north: { value: new THREE.Vector3() },
        span: { value: 1 },
        progress: { value: 0 },
        origin: { value: new THREE.Vector2(0.5, 0.5) },
        radius: { value: 0.75 },
        texel: { value: 1 / resolution },
      },
      vertexShader: `varying vec3 direction;
        void main(){direction=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform sampler2D mask;
        uniform vec3 centre,east,north;
        uniform vec2 origin;
        uniform float span,progress,radius,texel;
        varying vec3 direction;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        void main(){
          vec3 d=normalize(direction);
          if(dot(d,centre)<=0.0||progress<=0.0)discard;
          vec2 uv=vec2(dot(d,east),dot(d,north))/span*.5+.5;
          if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))discard;
          float coverage=texture2D(mask,uv).a;
          if(coverage<.004)discard;
          vec2 cell=floor((uv-origin)*160.0);
          float dist=length((cell+.5)/160.0);
          float wave=progress*(radius+.04);
          float pixelEdge=dist+(hash(cell)-.5)*.024;
          if(progress<1.0 && pixelEdge>wave)discard;
          vec2 e=max(fwidth(uv)*1.25,vec2(texel));
          float inner=min(min(texture2D(mask,uv+vec2(e.x,0)).a,texture2D(mask,uv-vec2(e.x,0)).a),
                          min(texture2D(mask,uv+vec2(0,e.y)).a,texture2D(mask,uv-vec2(0,e.y)).a));
          float edge=1.0-inner;
          float front=progress<.98 ? (1.0-smoothstep(.005,.025,wave-pixelEdge))*.4 : 0.0;
          gl_FragColor=vec4(vec3(1.0),coverage*max(.24+edge*.66,.24+front));
        }`,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.name = "selected-landform";
    mesh.scale.setScalar(1.0006);
    mesh.renderOrder = 4;
    mesh.visible = false;
    planet.add(mesh);
    let selected = null,
      started = 0,
      animating = false;
    function inside(area, x, y) {
      let hit = false;
      for (const polygon of area.polygons)
        for (const ring of polygon)
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
            if (
              ring[i][1] > y !== ring[j][1] > y &&
              x <
                ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) /
                  (ring[j][1] - ring[i][1]) +
                  ring[i][0]
            )
              hit = !hit;
      return hit;
    }
    function select(region, now = performance.now()) {
      selected = region;
      animating = false;
      material.uniforms.progress.value = 0;
      mesh.visible = !!region?.area.polygons.length;
      mesh.geometry.dispose();
      mesh.geometry = new THREE.BufferGeometry();
      if (!mesh.visible) return;
      const area = region.area;
      ctx.clearRect(0, 0, resolution, resolution);
      ctx.beginPath();
      for (const polygon of area.polygons)
        for (const ring of polygon) {
          ring.forEach(([x, y], i) => {
            const px = (x / area.n) * resolution,
              py = (1 - y / area.n) * resolution;
            i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          });
          ctx.closePath();
        }
      ctx.fillStyle = "#ffffff";
      ctx.fill("evenodd");
      texture.needsUpdate = true;
      // Use the named centre when inside the polygon. Otherwise start from the
      // nearest interior sample, so the circle emerges within the selected shape.
      let ox = area.n / 2,
        oy = area.n / 2;
      if (!inside(area, ox, oy)) {
        let nearest = Infinity;
        for (let y = 1; y < 64; y++)
          for (let x = 1; x < 64; x++) {
            const px = (x / 64) * area.n,
              py = (y / 64) * area.n,
              dist = Math.hypot(px - area.n / 2, py - area.n / 2);
            if (dist < nearest && inside(area, px, py)) {
              nearest = dist;
              ox = px;
              oy = py;
            }
          }
      }
      material.uniforms.origin.value.set(ox / area.n, oy / area.n);
      let radius = 0;
      for (const polygon of area.polygons)
        for (const ring of polygon)
          for (const [x, y] of ring)
            radius = Math.max(radius, Math.hypot(x - ox, y - oy) / area.n);
      material.uniforms.radius.value = radius;
      material.uniforms.centre.value.copy(region._normal);
      material.uniforms.east.value.copy(region._east);
      material.uniforms.north.value.copy(region._north);
      material.uniforms.span.value = area.s;
      // Copy only nearby triangles from the displayed planet. Identical vertices
      // avoid z-fighting without rendering another entire globe for a small crater.
      const source = terrainGeometry.attributes.position,
        index = terrainGeometry.index;
      const angularRadius =
        Math.asin(Math.min(0.9999, Math.SQRT2 * area.s)) + 0.045;
      const cap = Math.cos(angularRadius),
        dot = new Float32Array(source.count),
        v = new THREE.Vector3(),
        vertices = [];
      for (let i = 0; i < source.count; i++) {
        v.fromBufferAttribute(source, i).normalize();
        dot[i] = v.dot(region._normal);
      }
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i),
          b = index.getX(i + 1),
          c = index.getX(i + 2);
        if (dot[a] < cap && dot[b] < cap && dot[c] < cap) continue;
        for (const j of [a, b, c])
          vertices.push(source.getX(j), source.getY(j), source.getZ(j));
      }
      mesh.geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      mesh.geometry.computeBoundingSphere();
      started = now;
      animating = true;
    }
    function update(now) {
      if (!animating) return false;
      const t = Math.min(1, Math.max(0, (now - started) / 850));
      material.uniforms.progress.value = t * t * (3 - 2 * t);
      animating = t < 1;
      return true;
    }
    return {
      mesh,
      select,
      update,
      resolution,
      material,
      get selected() {
        return selected;
      },
      get animating() {
        return animating;
      },
      get progress() {
        return material.uniforms.progress.value;
      },
    };
  }
  root.MarsRegionSelection = { create };
})(window);
