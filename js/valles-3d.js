/* True-scale terrain mesh and draped routes; all inputs are bundled for file:// use. */
(function (root) {
  "use strict";
  function create({
    container,
    data,
    optical,
    pick,
    probe,
    clearProbe,
    conditionCanvas,
    hazardCanvas,
    slopeMap,
  }) {
    const T = root.THREE,
      scene = new T.Scene();
    scene.background = new T.Color("#182019");
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    container.append(renderer.domElement);
    const camera = new T.PerspectiveCamera(42, 1, 1, 30000);
    const controls = new root.TrackballControls(camera, renderer.domElement);
    controls.rotateSpeed = 2.2;
    controls.zoomSpeed = 1.15;
    controls.panSpeed = 0.5;
    controls.minDistance = 60;
    controls.maxDistance = data.extent * 5;
    controls.staticMoving = true;
    const elevations = data.heights.filter(Number.isFinite),
      zero = elevations.reduce((a, b) => a + b, 0) / elevations.length;
    const scenePoint = (p) =>
      new T.Vector3(
        p.x - data.extent / 2,
        (p.z ?? heightAt(p)) - zero,
        data.extent / 2 - p.y,
      );
    // South is -Z. This keeps north at the back in the initial camera view.
    function heightAt(p) {
      const x = Math.max(
          0,
          Math.min(data.width - 1, Math.floor(p.x / data.cellSize)),
        ),
        y = Math.max(
          0,
          Math.min(data.height - 1, Math.floor(p.y / data.cellSize)),
        );
      return data.heights[y * data.width + x] ?? zero;
    }
    const pos = new Float32Array(data.width * data.height * 3),
      uv = new Float32Array(data.width * data.height * 2),
      indices = [];
    for (let y = 0; y < data.height; y++)
      for (let x = 0; x < data.width; x++) {
        const i = y * data.width + x;
        scenePoint({
          x: (x + 0.5) * data.cellSize,
          y: (y + 0.5) * data.cellSize,
          z: data.heights[i] ?? zero,
        }).toArray(pos, i * 3);
        uv[i * 2] = (x + 0.5) / data.width;
        uv[i * 2 + 1] = 1 - (y + 0.5) / data.height;
        if (x >= data.width - 1 || y >= data.height - 1) continue;
        const a = i,
          b = i + 1,
          c = i + data.width,
          d = c + 1;
        if ([a, b, c, d].every((j) => Number.isFinite(data.heights[j])))
          indices.push(a, b, c, b, d, c);
      }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(pos, 3));
    geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new T.MeshStandardMaterial({
      color: 0xe2d8bf,
      roughness: 1,
      side: T.DoubleSide,
    });
    const terrain = new T.Mesh(geometry, material);
    scene.add(terrain);
    scene.add(new T.HemisphereLight(0xfff5dc, 0x5d665c, 2.1));
    const sun = new T.DirectionalLight(0xffebcd, 1.8);
    sun.position.set(-1, 2, -1);
    scene.add(sun);
    const lines = new T.Group(),
      markers = new T.Group();
    scene.add(lines, markers);
    let state = null,
      drawnRoutes = null,
      drawnMarkers = "",
      textureKey = "",
      drawnField = null,
      dirty = true;
    const traveler = new T.Mesh(
      new T.SphereGeometry(data.extent * 0.004, 12, 8),
      new T.MeshBasicMaterial({ color: 0xffffff }),
    );
    scene.add(traveler);
    traveler.visible = false;
    function clear(group) {
      while (group.children.length) {
        const child = group.children[0];
        group.remove(child);
        child.geometry?.dispose();
        child.material?.map?.dispose();
        child.material?.dispose();
      }
    }
    function sprite(point, text, color) {
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 80;
      const cx = c.getContext("2d");
      cx.fillStyle = "#152318e8";
      cx.fillRect(0, 0, 512, 80);
      cx.fillStyle = color;
      cx.font = "bold 31px Arial";
      cx.textAlign = "center";
      cx.fillText(text.slice(0, 34), 256, 51, 490);
      const tex = new T.CanvasTexture(c);
      tex.colorSpace = T.SRGBColorSpace;
      const label = new T.Sprite(
        new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
      );
      label.position.copy(scenePoint(point));
      label.position.y += 45;
      label.scale.set(data.extent * 0.21, data.extent * 0.033, 1);
      label.renderOrder = 5;
      markers.add(label);
      const pin = new T.Mesh(
        new T.SphereGeometry(data.extent * 0.0045, 12, 8),
        new T.MeshBasicMaterial({ color }),
      );
      pin.position.copy(scenePoint(point));
      pin.position.y += 7;
      markers.add(pin);
    }
    function paintTexture() {
      if (!optical.complete || !optical.naturalWidth) return;
      const key =
        state.layer === "hazards"
          ? "hazards:" + state.hazardLayer
          : state.layer;
      if (
        key === textureKey &&
        (!["conditions", "hazards"].includes(state.layer) ||
          drawnField === state.field)
      )
        return;
      const c = document.createElement("canvas");
      c.width = optical.naturalWidth;
      c.height = optical.naturalHeight;
      const cx = c.getContext("2d");
      cx.drawImage(optical, 0, 0);
      if (key === "slope") cx.drawImage(slopeMap, 0, 0, c.width, c.height);
      if (key === "conditions" && state.field)
        cx.drawImage(conditionCanvas(), 0, 0, c.width, c.height);
      if (state.layer === "hazards" && state.field)
        cx.drawImage(hazardCanvas(), 0, 0, c.width, c.height);
      const tex = new T.CanvasTexture(c);
      tex.colorSpace = T.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      material.map?.dispose();
      material.map = tex;
      material.needsUpdate = true;
      textureKey = key;
      drawnField = state.field;
    }
    function update(next) {
      state = next;
      if (!state) return;
      paintTexture();
      if (
        drawnRoutes !== state.evaluations ||
        lines.userData.selected !== state.selected
      ) {
        clear(lines);
        for (const route of state.evaluations) {
          const points = route.points.map((p) => {
            const v = scenePoint(p);
            v.y += 4;
            return v;
          });
          const curve = new T.CurvePath();
          for (let i = 1; i < points.length; i++)
            curve.add(new T.LineCurve3(points[i - 1], points[i]));
          if (points.length > 1) {
            const tube = new T.Mesh(
              new T.TubeGeometry(
                curve,
                Math.max(2, Math.ceil(route.distance / 2)),
                state.selected === route.id ? 3.5 : 2.5,
                5,
                false,
              ),
              new T.MeshBasicMaterial({
                color: route.id === "direct" ? 0xffb777 : 0xb2e4c1,
              }),
            );
            lines.add(tube);
          }
        }
        drawnRoutes = state.evaluations;
        lines.userData.selected = state.selected;
      }
      const mk = JSON.stringify([
        data.base,
        data.targets,
        state.target.id,
        state.layer,
      ]);
      if (mk !== drawnMarkers) {
        clear(markers);
        sprite(data.base, "BASE · PROPOSED", "#fff0c7");
        for (const p of data.targets)
          if (p.id === state.target.id || state.layer === "science")
            sprite(p, p.name, state.target.id === p.id ? "#b2e4c1" : "#dac5a5");
        drawnMarkers = mk;
      }
      traveler.visible = !!state.demo;
      if (state.demo) {
        const r = state.evaluations.find((r) => r.id === state.selected),
          e = state.demo.elapsed;
        const f =
          e < r.outbound
            ? e / r.outbound
            : e < r.outbound + r.science
              ? 1
              : 1 - (e - r.outbound - r.science) / r.inbound;
        const p =
          r.points[
            Math.max(
              0,
              Math.min(
                r.points.length - 1,
                Math.round(f * (r.points.length - 1)),
              ),
            )
          ];
        traveler.position.copy(scenePoint(p));
        traveler.position.y += 12;
      }
      dirty = true;
    }
    let previousAspect = null;
    function resize() {
      const r = container.getBoundingClientRect();
      if (!r.width || !r.height) return;
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      if (
        previousAspect !== null &&
        Math.abs(camera.aspect - previousAspect) > 0.1
      ) {
        const ratio =
          Math.max(1, 1 / camera.aspect) / Math.max(1, 1 / previousAspect);
        camera.position
          .sub(controls.target)
          .multiplyScalar(ratio)
          .add(controls.target);
      }
      previousAspect = camera.aspect;
      camera.updateProjectionMatrix();
      controls.handleResize();
      dirty = true;
    }
    function fit() {
      const f = Math.max(1, 1 / camera.aspect);
      camera.position.set(
        data.extent * 0.85 * f,
        data.extent * 0.78 * f,
        -data.extent * 0.95 * f,
      );
      controls.target.set(0, 0, 0);
      camera.lookAt(controls.target);
      controls.update();
      dirty = true;
    }
    function zoom(factor) {
      camera.position
        .sub(controls.target)
        .multiplyScalar(1 / factor)
        .add(controls.target);
      controls.update();
      dirty = true;
    }
    function focusRoute() {
      const route = state?.evaluations.find((r) => r.id === state.selected);
      if (!route) return;
      const box = new T.Box3().setFromPoints(route.points.map(scenePoint)),
        center = box.getCenter(new T.Vector3()),
        size = box.getSize(new T.Vector3());
      const span =
        Math.max(350, size.x, size.z) * 1.2 * Math.max(1, 1 / camera.aspect);
      controls.target.copy(center);
      camera.position
        .copy(center)
        .add(new T.Vector3(span * 0.4, span * 0.9, -span * 0.75));
      camera.lookAt(center);
      controls.update();
      dirty = true;
    }
    const ray = new T.Raycaster(),
      pointer = new T.Vector2();
    let down = null;
    function hit(e) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
      const h = ray.intersectObject(terrain)[0];
      return h
        ? {
            x: h.point.x + data.extent / 2,
            y: data.extent / 2 - h.point.z,
            z: h.point.y + zero,
          }
        : null;
    }
    renderer.domElement.addEventListener(
      "pointerdown",
      (e) => (down = { x: e.clientX, y: e.clientY }),
    );
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const p = hit(e);
        if (p) pick(p);
      }
      down = null;
    });
    renderer.domElement.addEventListener("pointermove", (e) => {
      if (down) {
        clearProbe();
        return;
      }
      const p = hit(e);
      p ? probe(p) : clearProbe();
    });
    renderer.domElement.addEventListener("pointerleave", clearProbe);
    controls.addEventListener("change", () => (dirty = true));
    optical.addEventListener("load", () => {
      textureKey = "";
      if (state) update(state);
    });
    window.addEventListener("resize", resize);
    renderer.setAnimationLoop(() => {
      if (container.hidden) return;
      controls.update();
      if (dirty) {
        for (const label of markers.children)
          if (label.isSprite) {
            const units =
              (2 *
                label.position.distanceTo(camera.position) *
                Math.tan((camera.fov * Math.PI) / 360)) /
              Math.max(1, container.clientHeight);
            label.scale.set(160 * units, 25 * units, 1);
          }
        renderer.render(scene, camera);
        dirty = false;
      }
    });
    resize();
    fit();
    return {
      update,
      resize,
      fit,
      zoom,
      focusRoute,
      renderer,
      camera,
      terrain,
      scenePoint,
      controls,
      geometry,
    };
  }
  root.Valles3D = { create };
})(window);
