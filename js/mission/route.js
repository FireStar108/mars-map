'use strict';
// Route maths: resampling, rating along the line, EVA budget, and an A* planner on the terrain layers.
(function (PG) {
  const SAMPLE_STEP = 2;        // m between rating samples
  const SEG_LEN = 20;           // m per rated stretch in the report
  const VERIFY_R = 5;           // m: a point counts as rover-verified if the rover drove this close
  const O2_KJ_PER_L = 20.1;     // energy released per litre of O2 at RQ ≈ 0.85
  const O2_G_PER_L = 1.429;
  const EVA_O2_KG = 1.2;        // usable O2 per crew member in a modern suit PLSS, ~8 h EVA

  const Route = {};
  Route.SEG_LEN = SEG_LEN;

  Route.length = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0), 0);

  Route.resample = function (pts, step = SAMPLE_STEP) {
    const out = [{ x: pts[0].x, z: pts[0].z, d: 0 }];
    let d = 0, carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.z - a.z);
      let t = step - carry;
      while (t <= L) {
        out.push({ x: a.x + (b.x - a.x) * t / L, z: a.z + (b.z - a.z) * t / L, d: d + t });
        t += step;
      }
      carry = L - (t - step);
      d += L;
    }
    const last = pts[pts.length - 1];
    if (Math.hypot(last.x - out[out.length - 1].x, last.z - out[out.length - 1].z) > 0.3) out.push({ x: last.x, z: last.z, d });
    return out;
  };

  // Douglas–Peucker in the XZ plane.
  Route.simplify = function (pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const A = pts[a], B = pts[b], dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1e-6;
      let best = -1, bi = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((pts[i].x - A.x) * dz - (pts[i].z - A.z) * dx) / L;
        if (d > best) { best = d; bi = i; }
      }
      if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  };

  // Spatial hash of rover samples, to tell verified ground from orbital-only ground.
  Route.Verifier = class {
    constructor(samples) {
      this.cells = new Map();
      for (const s of samples) {
        const k = `${Math.floor(s.x / VERIFY_R)},${Math.floor(s.z / VERIFY_R)}`;
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(s);
      }
    }
    near(x, z) {
      const cx = Math.floor(x / VERIFY_R), cz = Math.floor(z / VERIFY_R);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const L = this.cells.get(`${cx + a},${cz + b}`);
        if (!L) continue;
        for (const s of L) if (Math.hypot(s.x - x, s.z - z) < VERIFY_R) return s;
      }
      return null;
    }
  };

  // Rate a route. `ctx` = { env, clock, sun, wx }, `verifier` = Route.Verifier of rover samples.
  Route.evaluate = function (pts, ctx, verifier) {
    const T = ctx.env.T;
    const samples = Route.resample(pts);
    let time = 0, energyJ = 0, doseUGy = 0, maxSlope = 0, climb = 0;
    const counts = [0, 0, 0];
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      const s = ctx.env.sample(p.x, p.z, ctx.clock, ctx.sun, ctx.wx);
      const rover = verifier && verifier.near(p.x, p.z);
      p.verified = !!rover;
      // the rover's own measurement wins where it exists (it saw the real ground at that spot)
      if (rover) { s.rough = Math.max(s.rough, rover.s.rough); s.sand = Math.max(s.sand, rover.s.sand); }
      p.s = s;
      p.r = ctx.env.rate(s);
      maxSlope = Math.max(maxSlope, s.slope);
      if (i) {
        const q = samples[i - 1], ds = p.d - q.d, dh = s.elev - q.s.elev;
        const grade = dh / Math.max(0.01, ds);
        const v = PG.walkSpeed(grade) / (1 + 0.5 * s.sand + 2.5 * Math.max(0, s.rough - 0.03));
        const dt = ds / v;
        time += dt;
        energyJ += PG.metabolicW(grade, v) * dt;
        doseUGy += s.dose * dt / 3600;
        if (dh > 0) climb += dh;
        counts[p.r.lvl] += ds;
      }
    }
    // stretches of SEG_LEN metres, rated by their worst sample
    const segs = [];
    let start = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].d - samples[start].d >= SEG_LEN || i === samples.length - 1) {
        let lvl = 0, verified = true;
        const why = new Map();
        for (let k = start; k <= i; k++) {
          const r = samples[k].r;
          lvl = Math.max(lvl, r.lvl);
          if (!samples[k].verified) verified = false;
          for (const w of r.why) if (!why.has(w.msg.split(' —')[0].replace(/[\d.]+/g, '#'))) why.set(w.msg.split(' —')[0].replace(/[\d.]+/g, '#'), w);
        }
        segs.push({ a: start, b: i, d0: samples[start].d, d1: samples[i].d, lvl, verified, why: [...why.values()].sort((x, y) => y.l - x.l).slice(0, 2) });
        start = i;
      }
    }
    const total = samples.length ? samples[samples.length - 1].d : 0;
    const o2kg = energyJ / 1000 / O2_KJ_PER_L * O2_G_PER_L / 1000;
    return {
      samples, segs,
      stats: {
        length: total, time, energyWh: energyJ / 3600, o2kg, o2pct: o2kg / EVA_O2_KG * 100, dose: doseUGy, maxSlope, climb,
        pct: counts.map((c) => (total ? c / total * 100 : 0)),
        verifiedPct: samples.length ? samples.filter((s) => s.verified).length / samples.length * 100 : 0,
      },
    };
  };

  // A* on a 2 m grid. Cost per metre grows with slope, roughness and sand; >25° is impassable.
  Route.plan = function (env, from, to, ctx) {
    const T = env.T, step = 2, half = T.half - 3;
    const n = Math.floor((half * 2) / step) + 1;
    const toI = (x) => PG.clamp(Math.round((x + half) / step), 0, n - 1);
    const sx = toI(from.x), sz = toI(from.z), gx = toI(to.x), gz = toI(to.z);
    const cost = new Float32Array(n * n);
    // cost field (lazy: computed on first touch)
    cost.fill(-1);
    const L = PG.EVA_LIMITS;
    const cellCost = (i, j) => {
      const k = j * n + i;
      if (cost[k] >= 0) return cost[k];
      const x = i * step - half, z = j * step - half;
      const sl = T.slopeAt(x, z), ro = T.roughAt(x, z), sa = T.sandAt(x, z);
      let c = 1;
      if (sl > L.slopeNoGo) c = Infinity;
      else c += Math.max(0, sl - 6) * 0.25 + (sl > L.slopePoor ? 12 : 0) + (sl > L.slopeOk ? 2 : 0);
      c += Math.max(0, ro - 0.03) * 60 + (ro > L.roughPoor ? 12 : 0);
      c += sa > L.sandPoor ? 2 : 0;
      cost[k] = c;
      return c;
    };
    const g = new Float32Array(n * n).fill(Infinity);
    const came = new Int32Array(n * n).fill(-1);
    const heap = [];   // [f, k]
    const push = (f, k) => {
      heap.push([f, k]);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    const start = sz * n + sx, goal = gz * n + gx;
    g[start] = 0;
    push(0, start);
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let iter = 0;
    while (heap.length && iter++ < 600000) {
      const [, k] = pop();
      if (k === goal) break;
      const i = k % n, j = (k / n) | 0;
      for (const [di, dj, w] of D) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const kk = b * n + a, c = cellCost(a, b);
        if (!isFinite(c)) continue;
        const ng = g[k] + w * step * (c + cellCost(i, j)) / 2;
        if (ng < g[kk]) {
          g[kk] = ng; came[kk] = k;
          push(ng + Math.hypot(a - gx, b - gz) * step, kk);
        }
      }
    }
    if (came[goal] < 0 && goal !== start) return null;
    const path = [];
    for (let k = goal; k >= 0; k = came[k]) { path.push({ x: (k % n) * step - half, z: ((k / n) | 0) * step - half }); if (k === start) break; }
    path.reverse();
    path[0] = { x: from.x, z: from.z };
    path[path.length - 1] = { x: to.x, z: to.z };
    return Route.simplify(path, 1.2);
  };

  PG.Route = Route;
})(window.PG);
