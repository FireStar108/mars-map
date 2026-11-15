/* A screen-space viewfinder, independent of the geographic selection polygon. */
(function (root) {
  "use strict";
  function create({ THREE, camera, positionAt, minDistance }) {
    const overlay = document.createElement("div");
    overlay.id = "region-capture";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `<div class="capture-frame"><i class="capture-flash"></i>
      <i class="capture-corner tl"></i><i class="capture-corner tr"></i>
      <i class="capture-corner bl"></i><i class="capture-corner br"></i>
      <span class="capture-name"></span><span class="capture-state"></span></div>`;
    document.body.append(overlay);
    const frame = overlay.firstElementChild;
    const name = frame.querySelector(".capture-name");
    const status = frame.querySelector(".capture-state");
    const flash = frame.querySelector(".capture-flash");
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let region = null,
      points = [],
      centre = null,
      pending = false,
      audio = null;
    let captures = 0;
    const projected = new THREE.Vector3();

    function cancel() {
      pending = false;
      for (const animation of frame.getAnimations({ subtree: true }))
        animation.cancel();
      if (region)
        status.textContent = region.area.polygons.length
          ? "SELECTED"
          : "LOCATION ONLY";
    }
    function clear() {
      cancel();
      region = null;
      points = [];
      overlay.hidden = true;
    }
    function primeAudio() {
      // Create/resume only inside a real user gesture; a denied audio context
      // must never prevent selection or leave an unhandled rejection.
      if (!navigator.userActivation?.isActive) return;
      try {
        const Context = root.AudioContext || root.webkitAudioContext;
        if (!Context) return;
        audio ||= new Context();
        if (audio.state === "suspended") audio.resume().catch(() => {});
      } catch {}
    }
    function shutter() {
      if (!audio || audio.state !== "running") return;
      try {
        const buffer = audio.createBuffer(
          1,
          Math.ceil(audio.sampleRate * 0.065),
          audio.sampleRate,
        );
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          const t = i / audio.sampleRate;
          const envelope =
            Math.exp(-t * 240) +
            (t > 0.028 ? 0.45 * Math.exp(-(t - 0.028) * 220) : 0);
          data[i] = (Math.random() * 2 - 1) * envelope;
        }
        const source = audio.createBufferSource(),
          filter = audio.createBiquadFilter(),
          gain = audio.createGain();
        source.buffer = buffer;
        filter.type = "highpass";
        filter.frequency.value = 900;
        gain.gain.value = 0.08;
        source.connect(filter).connect(gain).connect(audio.destination);
        source.onended = () => {
          source.disconnect();
          filter.disconnect();
          gain.disconnect();
        };
        source.start();
      } catch {}
    }
    function bounds(view, visibleOnly = false) {
      let left = Infinity,
        right = -Infinity,
        top = Infinity,
        bottom = -Infinity;
      for (const p of points) {
        if (visibleOnly && p.dot(view.position) < p.lengthSq() * 0.998)
          continue;
        projected.copy(p).project(view);
        if (projected.z > 1 || projected.z < -1) continue;
        const x = (projected.x * 0.5 + 0.5) * innerWidth;
        const y = (0.5 - projected.y * 0.5) * innerHeight;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
      return Number.isFinite(left) ? { left, right, top, bottom } : null;
    }
    function select(next) {
      clear();
      region = next;
      primeAudio();
      const a = region.area;
      for (const polygon of a.polygons)
        for (const ring of polygon)
          for (const [x, y] of ring) {
            const u = ((x / a.n) * 2 - 1) * a.s;
            const v = ((y / a.n) * 2 - 1) * a.s;
            const normal = region._normal
              .clone()
              .multiplyScalar(Math.sqrt(Math.max(0, 1 - u * u - v * v)))
              .addScaledVector(region._east, u)
              .addScaledVector(region._north, v)
              .normalize();
            points.push(
              positionAt(
                (Math.asin(normal.y) * 180) / Math.PI,
                (Math.atan2(-normal.z, normal.x) * 180) / Math.PI,
              ),
            );
          }
      if (!points.length) points.push(region._position.clone());
      centre = new THREE.Box3()
        .setFromPoints(points)
        .getCenter(new THREE.Vector3())
        .normalize();
      name.textContent = region.name;
      status.textContent = "ACQUIRING";
      frame.dataset.regionId = region.id;
      pending = true;

      // Fit the actual contour to a square in the free map viewport, rather
      // than zooming by catalogue diameter (long valleys are often asymmetric).
      let side = Math.min(600, innerHeight * 0.54, innerWidth - 40);
      if (innerWidth > 700) {
        for (const id of ["region-browser-shell", "region-card"]) {
          const element = document.getElementById(id);
          if (element.hidden || getComputedStyle(element).display === "none")
            continue;
          const box = element.getBoundingClientRect();
          side = Math.min(
            side,
            2 *
              (id === "region-card"
                ? box.left - innerWidth / 2 - 24
                : innerWidth / 2 - box.right - 24),
          );
        }
      } else side = Math.min(side, innerHeight * 0.27, 260);
      side = Math.max(120, side) - 36;
      const view = new THREE.PerspectiveCamera(
        camera.fov,
        camera.aspect,
        camera.near,
        camera.far,
      );
      let low = minDistance,
        high = 5.5;
      for (const p of points)
        low = Math.max(
          low,
          p.lengthSq() / Math.max(0.01, p.dot(centre)) + 0.015,
        );
      low = Math.min(low, high);
      for (let i = 0; i < 20; i++) {
        const distance = (low + high) / 2;
        view.position.copy(centre).multiplyScalar(distance);
        view.lookAt(0, 0, 0);
        view.updateMatrixWorld();
        const b = bounds(view);
        if (!b || Math.max(b.right - b.left, b.bottom - b.top) > side)
          low = distance;
        else high = distance;
      }
      return {
        lat: (Math.asin(centre.y) * 180) / Math.PI,
        lon: (Math.atan2(-centre.z, centre.x) * 180) / Math.PI,
        distance: high,
      };
    }
    function update() {
      if (!region || centre.dot(camera.position) <= 1) {
        overlay.hidden = true;
        return;
      }
      const b = bounds(camera, true);
      if (!b) {
        overlay.hidden = true;
        return;
      }
      const side = Math.max(
        region.area.polygons.length ? 88 : 96,
        b.right - b.left + 32,
        b.bottom - b.top + 32,
      );
      const x = (b.left + b.right - side) / 2,
        y = (b.top + b.bottom - side) / 2;
      overlay.hidden =
        x + side < 0 || y + side < 0 || x > innerWidth || y > innerHeight;
      frame.style.transform = `translate3d(${x}px,${y}px,0)`;
      frame.style.width = frame.style.height = `${side}px`;
    }
    function capture() {
      if (!region || !pending) return;
      pending = false;
      captures++;
      status.textContent = region.area.polygons.length
        ? "AREA ACQUIRED"
        : "LOCATION · BOUNDARY UNRESOLVED";
      if (!reducedMotion.matches) {
        flash.animate(
          [{ opacity: 0 }, { opacity: 0.4, offset: 0.12 }, { opacity: 0 }],
          { duration: 260, easing: "ease-out" },
        );
        frame.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 320 });
      }
      shutter();
    }
    return {
      select,
      clear,
      cancel,
      update,
      capture,
      get pending() {
        return pending;
      },
      get captures() {
        return captures;
      },
      get reducedMotion() {
        return reducedMotion.matches;
      },
    };
  }
  root.MarsRegionCapture = { create };
})(window);
