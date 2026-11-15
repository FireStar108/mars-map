/* All resolved landform outlines. Catalogue boxes and nominal circles are never drawn. */
"use strict";
window.MarsNomenclatureLayer = {
  create({ THREE, regions, groups, planet, positionAt }) {
    const meshes = new Map();
    let segmentCount = 0;
    for (const [key, group] of Object.entries(groups)) {
      const coordinates = [];
      for (const feature of regions) {
        if (feature.group !== key || !feature.area.polygons.length) continue;
        const { n, s, polygons } = feature.area;
        const project = (x, y) => {
          const px = ((x / n) * 2 - 1) * s,
            py = ((y / n) * 2 - 1) * s;
          const direction = feature._normal
            .clone()
            .multiplyScalar(Math.sqrt(Math.max(0, 1 - px * px - py * py)))
            .addScaledVector(feature._east, px)
            .addScaledVector(feature._north, py)
            .normalize();
          const lat = (Math.asin(direction.y) * 180) / Math.PI;
          const lon = (Math.atan2(-direction.z, direction.x) * 180) / Math.PI;
          return positionAt(lat, lon, 0.0012);
        };
        for (const polygon of polygons)
          for (const ring of polygon) {
            for (let i = 1; i < ring.length; i++) {
              const [ax, ay] = ring[i - 1],
                [bx, by] = ring[i];
              // Follow the sphere and displayed relief instead of chord shortcuts.
              const steps = Math.max(
                1,
                Math.ceil(
                  ((Math.hypot(bx - ax, by - ay) / n) * 2 * s) / 0.0025,
                ),
              );
              let previous = project(ax, ay);
              for (let j = 1; j <= steps; j++) {
                const t = j / steps,
                  next = project(ax + (bx - ax) * t, ay + (by - ay) * t);
                coordinates.push(
                  previous.x,
                  previous.y,
                  previous.z,
                  next.x,
                  next.y,
                  next.z,
                );
                previous = next;
                segmentCount++;
              }
            }
          }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(coordinates, 3),
      );
      const material = new THREE.LineBasicMaterial({
        color: group.color,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      });
      const mesh = new THREE.LineSegments(geometry, material);
      mesh.renderOrder = 3;
      planet.add(mesh);
      meshes.set(key, mesh);
    }
    return {
      meshes,
      segmentCount,
      featureCount: regions.filter((r) => r.area.polygons.length).length,
      setVisible(active, enabled) {
        for (const [key, mesh] of meshes)
          mesh.visible = active && enabled.has(key);
      },
    };
  },
};
