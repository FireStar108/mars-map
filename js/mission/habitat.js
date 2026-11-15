'use strict';
// Surface base at the spawn point: two hard modules, an inflatable dome, an airlock, a regolith-bag berm
// against radiation, solar arrays and a comms mast. Built from primitives, placed on the real terrain.
(function (PG) {
  PG.buildHabitat = function (terrain, cx, cz, yaw) {
    // Locate a nearby gentle patch before sizing the supports.
    let best = { cost: Infinity, x: cx, z: cz };
    for (let x = -65; x <= 65; x += 10) {
      for (let z = -65; z <= 45; z += 10) {
        if (Math.hypot(x, z) < 30) continue;
        let low = Infinity, high = -Infinity;
        for (let dx = -12; dx <= 15; dx += 3) {
          for (let dz = -8; dz <= 13; dz += 3) {
            const h = terrain.heightAt(x + dx, z + dz);
            low = Math.min(low, h); high = Math.max(high, h);
          }
        }
        const cost = high - low + Math.hypot(x - cx, z - cz) * 0.025;
        if (cost < best.cost) best = { cost, x, z };
      }
    }
    cx = best.x; cz = best.z;
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xe4ded6, roughness: 0.55, metalness: 0.05 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.6, metalness: 0.3 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xd9531e, roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1b2633, roughness: 0.15, metalness: 0.6, emissive: 0xffb36b, emissiveIntensity: 0.35 });
    const fabric = new THREE.MeshStandardMaterial({ color: 0xd8cfc2, roughness: 0.85 });
    const panel = new THREE.MeshStandardMaterial({ color: 0x14203a, roughness: 0.25, metalness: 0.7 });
    const bag = new THREE.MeshStandardMaterial({ color: 0x8e5a3c, roughness: 0.95 });
    const all = [];
    const add = (mesh, x, y, z, ry = 0) => {
      mesh.position.set(x, y, z);
      mesh.rotation.y += ry;
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh); all.push(mesh);
      return mesh;
    };
    const groundAt = (x, z) => terrain.heightAt(
      cx + Math.cos(yaw) * x - Math.sin(yaw) * z,
      cz + Math.sin(yaw) * x + Math.cos(yaw) * z);
    // A level deck clears the highest elevation under the complete module footprint.
    let h0 = -Infinity;
    for (let x = -12; x <= 15; x += 0.5) {
      for (let z = -8; z <= 13; z += 0.5) h0 = Math.max(h0, groundAt(x, z));
    }
    h0 += 0.7;
    add(new THREE.Mesh(new THREE.BoxGeometry(27, 0.35, 21), grey), 1.5, h0 - 0.5, 2.5);
    for (let x = -11; x <= 14; x += 5) {
      for (const z of [-7, 2.5, 12]) {
        const ground = groundAt(x, z);
        const height = h0 - 0.65 - ground;
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, height, 10), grey),
          x, ground + height / 2, z);
        add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 1.2), grey), x, ground + 0.05, z);
      }
    }

    // hard module A (lengthwise X) and B (lengthwise Z), on legs
    const mod = (len) => {
      const m = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, len, 32, 1), white);
      body.rotation.z = Math.PI / 2;
      m.add(body);
      for (const s of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(2.1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), white);
        cap.rotation.z = -s * Math.PI / 2; cap.position.x = s * len / 2; cap.scale.y = 0.35;
        m.add(cap);
      }
      for (let k = -1; k <= 1; k++) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(2.14, 2.14, 0.22, 32, 1, true), orange);
        band.rotation.z = Math.PI / 2; band.position.x = k * len * 0.33;
        m.add(band);
      }
      for (let k = -2; k <= 2; k++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.32, 0.1), glass);
        win.position.set(k * 1.4, 0.6, 2.05);
        m.add(win);
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 2.2, 8), grey);
        leg.position.set(sx * len * 0.36, -2.0, sz * 1.3);
        leg.rotation.z = sx * 0.12;
        m.add(leg);
      }
      m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return m;
    };
    const A = mod(9); A.position.set(0, h0 + 3.0, 0); g.add(A);
    const B = mod(7); B.rotation.y = Math.PI / 2; B.position.set(-6.5, h0 + 3.0, 5.5); g.add(B);
    const tunnel = add(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 3.2, 20), grey), -5.2, h0 + 3.0, 1.4);
    tunnel.rotation.x = Math.PI / 2;

    // inflatable dome with ribs
    const dome = add(new THREE.Mesh(new THREE.SphereGeometry(5.5, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), fabric), 8.5, h0 - 0.4, 6.5);
    dome.scale.y = 0.72;
    for (let k = 0; k < 8; k++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(5.52, 0.07, 6, 48, Math.PI), grey);
      rib.position.copy(dome.position); rib.scale.y = 0.72;
      rib.rotation.y = (k / 8) * Math.PI;
      g.add(rib);
    }
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.18, 8, 64), orange), 8.5, h0 - 0.3, 6.5);
    ring.rotation.x = Math.PI / 2;
    const link = add(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 3.6, 20), grey), 4.6, h0 + 1.6, 3.2);
    link.rotation.z = Math.PI / 2; link.rotation.y = -0.6;

    // airlock with a lit door, facing the route
    const lock = add(new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 2.6, 24), white), 0, h0 + 2.2, -3.4);
    lock.rotation.x = Math.PI / 2;
    const door = add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.7, 0.08), orange), 0, h0 + 2.1, -4.72);
    const steps = add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 2.6), grey), 0, h0 + 0.9, -6.0);
    steps.rotation.x = -0.55;
    const lamp = new THREE.PointLight(0xffc48a, 6, 14, 1.6);
    lamp.position.set(0, h0 + 3.4, -5.2);
    g.add(lamp);

    // regolith-bag berm (radiation and micrometeorite shielding) around the modules
    const bagGeo = new THREE.BoxGeometry(1.0, 0.42, 0.55);
    const bags = [];
    for (let a = 0.35; a < Math.PI * 1.65; a += 0.075) {
      const r = 10.5 + Math.sin(a * 3) * 0.6;
      for (let row = 0; row < 3; row++) bags.push({ a: a + (row % 2) * 0.035, r: r - row * 0.15, row });
    }
    const im = new THREE.InstancedMesh(bagGeo, bag, bags.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    bags.forEach((b, i) => {
      const x = Math.cos(b.a) * b.r - 1, z = Math.sin(b.a) * b.r + 2;
      const y = groundAt(x, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -b.a + Math.PI / 2 + (Math.random() - 0.5) * 0.1);
      m4.compose(new THREE.Vector3(x, y + 0.18 + b.row * 0.38, z), q, s);
      im.setMatrixAt(i, m4);
    });
    im.castShadow = true; im.receiveShadow = true;
    g.add(im);

    // solar arrays
    for (let r = 0; r < 2; r++) for (let k = 0; k < 5; k++) {
      const x = 16 + k * 4.4, z = -6 + r * 5.5;
      const p = add(new THREE.Mesh(new THREE.BoxGeometry(4, 0.06, 2.4), panel), x, groundAt(x, z) + 1.8, z);
      p.rotation.x = -0.3;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6), grey), x, groundAt(x, z) + 0.9, z);
    }
    h0 = groundAt(-13, -4);
    // comms mast and dish
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 9, 8), grey), -13, h0 + 4.5, -4);
    const dish = add(new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 8, 0, Math.PI * 2, 0, 0.9), white), -13, h0 + 8.6, -4);
    dish.rotation.x = -1.1;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b2a }));
    beacon.position.set(-13, h0 + 9.1, -4);
    g.add(beacon);
    g.userData.beacon = beacon;

    g.position.set(cx, 0, cz);
    g.rotation.y = -yaw;
    // the modules sit at h0 in world Y; the group is only translated in XZ
    g.userData.footprint = { x: cx, z: cz, r: 15 };
    return g;
  };
})(window.PG);
