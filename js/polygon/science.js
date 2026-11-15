'use strict';
// Научные модели: составы пород кратера Гейл, спектры приборов, погода, радиация, питание, связь.
// Значения — правдоподобные по опубликованным данным Curiosity, но генерируются, а не берутся из архива.
(function (PG) {
  // Оксиды, % масс.
  const OXIDES = ['SiO2', 'TiO2', 'Al2O3', 'FeOT', 'MgO', 'CaO', 'Na2O', 'K2O', 'SO3', 'Cl'];
  const COMP = {
    soil:         { SiO2: 43.0, TiO2: 1.1, Al2O3: 9.4, FeOT: 19.2, MgO: 8.7, CaO: 7.3, Na2O: 2.7, K2O: 0.5, SO3: 5.5, Cl: 0.6 },
    basalt:       { SiO2: 46.5, TiO2: 1.1, Al2O3: 10.2, FeOT: 19.0, MgO: 9.2, CaO: 7.6, Na2O: 2.9, K2O: 0.5, SO3: 1.0, Cl: 0.3 },
    mudstone:     { SiO2: 50.2, TiO2: 1.0, Al2O3: 12.1, FeOT: 17.2, MgO: 4.6, CaO: 2.4, Na2O: 3.0, K2O: 1.2, SO3: 2.1, Cl: 0.5 },
    sandstone:    { SiO2: 45.5, TiO2: 1.0, Al2O3: 11.0, FeOT: 18.4, MgO: 8.4, CaO: 6.4, Na2O: 3.2, K2O: 0.6, SO3: 1.3, Cl: 0.4 },
    conglomerate: { SiO2: 55.3, TiO2: 0.9, Al2O3: 15.1, FeOT: 11.8, MgO: 3.9, CaO: 5.0, Na2O: 4.6, K2O: 1.6, SO3: 0.6, Cl: 0.2 },
    sulfate:      { SiO2: 4.0, TiO2: 0.1, Al2O3: 0.8, FeOT: 1.5, MgO: 0.8, CaO: 38.5, Na2O: 0.3, K2O: 0.1, SO3: 53.0, Cl: 0.1 },
    meteorite:    { SiO2: 0.3, TiO2: 0.0, Al2O3: 0.1, FeOT: 91.0, MgO: 0.1, CaO: 0.1, Na2O: 0.0, K2O: 0.0, SO3: 0.4, Cl: 0.0, Ni: 7.6 },
  };
  const MINERALS = {
    soil:         [['Плагиоклаз', 30], ['Пироксен', 25], ['Оливин', 20], ['Магнетит', 3], ['Аморфная фаза', 22]],
    basalt:       [['Плагиоклаз', 40], ['Авгит', 18], ['Пижонит', 12], ['Оливин', 15], ['Магнетит', 5], ['Аморфная фаза', 10]],
    mudstone:     [['Плагиоклаз', 24], ['Смектит (глина)', 20], ['Гематит', 8], ['Пироксен', 8], ['Ярозит', 3], ['Магнетит', 4], ['Аморфная фаза', 33]],
    sandstone:    [['Плагиоклаз', 35], ['Пироксен', 25], ['Магнетит', 8], ['Оливин', 5], ['Санидин', 5], ['Аморфная фаза', 22]],
    conglomerate: [['Плагиоклаз', 45], ['Санидин', 15], ['Пироксен', 10], ['Аморфная фаза', 30]],
    sulfate:      [['Гипс', 48], ['Бассанит', 32], ['Ангидрит', 20]],
    meteorite:    [['Камасит', 88], ['Тэнит', 9], ['Шрейберзит', 3]],
  };
  // Положения пиков XRD (2θ, Co-Kα) и относительная сила.
  const XRD = {
    'Плагиоклаз': [[25.6, 0.5], [32.4, 1], [32.7, 0.8], [27.5, 0.3]],
    'Пироксен': [[34.8, 1], [35.7, 0.7], [41.9, 0.4]], 'Авгит': [[34.9, 1], [35.6, 0.6]], 'Пижонит': [[35.4, 1], [41.7, 0.4]],
    'Оливин': [[38.1, 0.8], [41.6, 1], [43.0, 0.5]], 'Магнетит': [[41.5, 1], [50.7, 0.4]], 'Гематит': [[38.6, 1], [41.7, 0.7]],
    'Смектит (глина)': [[10.2, 1.4]], 'Ярозит': [[20.2, 0.8], [33.6, 1]], 'Санидин': [[31.6, 1], [32.1, 0.7]],
    'Гипс': [[13.6, 1], [24.0, 0.6], [33.6, 0.5]], 'Бассанит': [[17.1, 1], [34.5, 0.6]], 'Ангидрит': [[29.6, 1], [36.4, 0.4]],
    'Камасит': [[52.4, 1]], 'Тэнит': [[51.0, 1]], 'Шрейберзит': [[47.6, 1]],
  };
  // Линии LIBS (нм): элемент → [[λ, сила]]
  const LIBS = {
    Si: [[288.16, 1], [251.61, 0.6], [252.85, 0.35], [390.55, 0.15]],
    Ti: [[334.94, 0.5], [336.12, 0.4], [337.28, 0.3], [323.45, 0.3]],
    Al: [[308.22, 0.6], [309.27, 0.8], [394.40, 0.7], [396.15, 0.9]],
    Fe: [[259.94, 0.7], [273.95, 0.4], [275.57, 0.4], [404.58, 0.3], [438.35, 0.25], [371.99, 0.3], [302.06, 0.2]],
    Mg: [[279.55, 1], [280.27, 0.8], [285.21, 0.6], [518.36, 0.2]],
    Ca: [[393.37, 1], [396.85, 0.9], [422.67, 0.6], [315.89, 0.2], [849.8, 0.2]],
    Na: [[588.99, 1], [589.59, 0.8], [818.3, 0.15]],
    K: [[766.49, 0.9], [769.90, 0.7]],
    H: [[656.28, 1]], O: [[777.4, 0.8]], C: [[247.86, 0.4]], S: [[543.3, 0.15], [545.4, 0.12]],
    Mn: [[257.61, 0.4], [403.08, 0.3]], Ni: [[341.48, 0.5], [352.45, 0.4], [361.94, 0.3]], Cl: [[837.6, 0.2]], Li: [[670.78, 0.6]],
  };
  // Линии APXS (кэВ)
  const APXS = [['Na', 1.041], ['Mg', 1.254], ['Al', 1.487], ['Si', 1.740], ['P', 2.013], ['S', 2.307], ['Cl', 2.622],
    ['K', 3.314], ['Ca', 3.692], ['Ti', 4.511], ['Cr', 5.415], ['Mn', 5.899], ['Fe', 6.404], ['Ni', 7.478], ['Zn', 8.639], ['Br', 11.92]];

  function hashSeed(...v) { let h = 2166136261; for (const x of v) { h ^= Math.floor(x * 1000); h = Math.imul(h, 16777619); } return h >>> 0; }

  PG.Science = {
    OXIDES, COMP, MINERALS,

    // Состав цели: тип + разброс по координатам; пыль подмешивает состав грунта.
    composition(type, pos, dusty) {
      const base = COMP[type] || COMP.soil, R = PG.rng(hashSeed(pos.x, pos.z, 3));
      const out = {};
      let sum = 0;
      for (const k of Object.keys(base)) { out[k] = Math.max(0, base[k] * (1 + (R() - 0.5) * 0.12)); sum += out[k]; }
      if (dusty && type !== 'soil') for (const k of Object.keys(out)) out[k] = out[k] * 0.82 + (COMP.soil[k] || 0) * 0.18;
      const total = Object.values(out).reduce((a, b) => a + b, 0);
      for (const k of Object.keys(out)) out[k] *= 99 / total;
      return out;
    },

    elements(ox) {
      return {
        Si: ox.SiO2 * 0.467, Ti: ox.TiO2 * 0.6, Al: ox.Al2O3 * 0.529, Fe: ox.FeOT * 0.777, Mg: ox.MgO * 0.603,
        Ca: ox.CaO * 0.715, Na: ox.Na2O * 0.742, K: ox.K2O * 0.83, S: (ox.SO3 || 0) * 0.4, Cl: ox.Cl || 0, Ni: ox.Ni || 0.05,
        Mn: 0.3, H: 0.4, O: 40, C: 0.2, Li: 0.002, P: 0.4, Cr: 0.3, Zn: 0.05, Br: 0.01,
      };
    },

    // Спектр LIBS: 3 спектрометра ChemCam (UV 240–342, VIO 382–469, VNIR 474–906 нм)
    libs(ox, shots, pos) {
      const el = this.elements(ox), R = PG.rng(hashSeed(pos.x, pos.z, shots));
      const lo = 240, hi = 860, step = 0.25, n = Math.round((hi - lo) / step);
      const y = new Float32Array(n);
      const ranges = [[240, 342], [382, 469], [474, 906]];
      const inRange = (l) => ranges.some((r) => l >= r[0] && l <= r[1]);
      const sens = { Na: 6, K: 4, Li: 30, H: 2, O: 0.12, Ca: 1.6, Mg: 1.5, Al: 1.2, Si: 0.9, Fe: 0.55, Ti: 1.6, Ni: 0.8, Mn: 1, C: 1, S: 0.6, Cl: 0.6 };
      for (const [e, lines] of Object.entries(LIBS)) {
        const a = Math.sqrt(Math.max(0, el[e] || 0)) * (sens[e] || 1);
        for (const [l, s] of lines) {
          const c = (l - lo) / step, w = 0.18 / step;
          for (let i = Math.max(0, Math.floor(c - 30)); i < Math.min(n, Math.ceil(c + 30)); i++) {
            const dx = (i - c) / w; y[i] += a * s / (1 + dx * dx);
          }
        }
      }
      let max = 0;
      for (let i = 0; i < n; i++) {
        const l = lo + i * step;
        if (!inRange(l)) { y[i] = NaN; continue; }
        y[i] += 0.25 + 0.15 * Math.sin(l / 40) + (R() - 0.5) * 0.08 * (30 / shots);
        max = Math.max(max, y[i]);
      }
      for (let i = 0; i < n; i++) y[i] /= max;
      return { lo, step, y };
    },

    // Рентгеновский спектр APXS (0–20 кэВ), счёт за время интеграции.
    apxs(ox, seconds, pos) {
      const el = this.elements(ox), R = PG.rng(hashSeed(pos.x, pos.z, 7));
      const n = 400, de = 20 / n, y = new Float32Array(n);
      const add = (E, A) => { const s = 0.05 + 0.012 * Math.sqrt(E); for (let i = 0; i < n; i++) { const d = (i * de - E) / s; y[i] += A * Math.exp(-0.5 * d * d); } };
      const fl = (E) => 1 / (0.4 + Math.exp(-(E - 1.2) * 2.5));   // эффективность флуоресценции
      for (const [e, E] of APXS) {
        const a = (el[e] || 0) * fl(E) * 40;
        add(E, a);
        if (E > 3.5) add(E * 1.103, a * 0.13);   // Kβ
      }
      add(14.3, 60); add(18.3, 35); add(12.1, 25);   // рассеяние источника Cm-244/Pu
      const scale = seconds / 600;
      for (let i = 0; i < n; i++) y[i] = Math.max(0, (y[i] + 6 * Math.exp(-i * de / 6)) * scale + (R() - 0.5) * Math.sqrt(y[i] * scale + 1) * 1.6);
      return { de, y };
    },

    chemin(type, pos) {
      const list = (MINERALS[type] || MINERALS.soil).map(([n, w]) => [n, w]);
      const R = PG.rng(hashSeed(pos.x, pos.z, 11));
      const n = 900, lo = 5, hi = 50, y = new Float32Array(n);
      const amorph = list.find((m) => m[0] === 'Аморфная фаза');
      for (let i = 0; i < n; i++) {
        const t = lo + (hi - lo) * i / n;
        y[i] = 4 + 30 * Math.exp(-t / 6) + (amorph ? amorph[1] * 0.4 * Math.exp(-(((t - 30) / 7) ** 2)) : 0);
      }
      for (const [name, w] of list) {
        for (const [p, s] of XRD[name] || []) {
          for (let i = 0; i < n; i++) {
            const t = lo + (hi - lo) * i / n, d = (t - p) / 0.22;
            y[i] += w * s * 2.2 * Math.exp(-0.5 * d * d);
          }
        }
      }
      for (let i = 0; i < n; i++) y[i] += (R() - 0.5) * 2;
      return { lo, hi, y, minerals: list };
    },

    // SAM: газы при нагреве образца 30→870 °C (квадрупольный масс-спектрометр)
    sam(type, pos) {
      const R = PG.rng(hashSeed(pos.x, pos.z, 13));
      const T = [], n = 200;
      for (let i = 0; i < n; i++) T.push(30 + (840 * i) / (n - 1));
      const g = (c, w, a) => T.map((t) => a * Math.exp(-0.5 * ((t - c) / w) ** 2));
      const sum = (...arrs) => T.map((_, i) => arrs.reduce((s, a) => s + a[i], 0) + R() * 0.02);
      const clay = type === 'mudstone' ? 1 : 0, sulf = type === 'sulfate' ? 1 : 0, met = type === 'meteorite' ? 1 : 0;
      const gases = {
        'H₂O': sum(g(150, 60, 1), g(500, 90, 0.8 * clay + 0.15), g(720, 60, 0.5 * clay), g(160, 40, 0.8 * sulf)),
        'CO₂': sum(g(320, 80, 0.45 + 0.3 * clay), g(620, 70, 0.2)),
        'O₂': sum(g(420, 55, met ? 0.02 : 0.45 + 0.2 * clay)),
        'SO₂': sum(g(700, 70, 0.25 + 1.4 * sulf), g(800, 40, 0.2 * clay)),
        'HCl': sum(g(460, 60, met ? 0.02 : 0.25)),
        'C₆H₅Cl': sum(g(330, 50, 0.03 + 0.12 * clay)),
      };
      const organics = clay ? `${Math.round(150 + R() * 150)}–${Math.round(300 + R() * 300)} ppb хлорбензола, дихлоралканы` : `${Math.round(10 + R() * 40)} ppb хлорбензола (фон)`;
      return {
        T, gases, organics,
        dD: Math.round(clay ? 3000 + R() * 600 : 4800 + R() * 900),
        d13C: Math.round(-30 + R() * 10 + (clay ? -40 : 0)),
        water: (clay ? 2.4 + R() : sulf ? 4 + R() * 2 : 1.4 + R() * 0.8).toFixed(1),
      };
    },
  };

  // ---------- REMS, RAD, DAN ----------
  PG.Weather = class {
    constructor() { this.noise = new PG.Noise(321); this.radDose = 0; this.sep = 0; }
    read(clock, sunDir) {
      const h = clock.hours, N = this.noise, t = clock.elapsed / 600;
      const el = sunDir.y;
      const dayCurve = Math.max(0, Math.sin(((h - 6.3) / 13.4) * Math.PI));
      const ground = -82 + 102 * Math.pow(dayCurve, 0.8) + 2 * N.n2(t, 1);
      const air = -78 + 66 * Math.pow(Math.max(0, Math.sin(((h - 6.8) / 13.8) * Math.PI)), 0.9) + 2.5 * N.n2(t, 5);
      const pressure = 742 * (1 + 0.045 * Math.cos(2 * Math.PI * (h - 6) / 24) + 0.02 * Math.cos(4 * Math.PI * (h - 10) / 24)) + 3 * N.n2(t, 9);
      const rh = PG.clamp(55 * Math.exp(-(air + 78) / 12), 0, 70);
      const wind = Math.max(0.3, 4 + 3.5 * dayCurve + 3 * N.n2(t * 3, 13));
      const windDir = (360 + (h > 10 && h < 18 ? 160 : 340) + 40 * N.n2(t, 17)) % 360;
      const uv = Math.max(0, el) * 0.86;
      return {
        ground, air, pressure, rh, wind, windDir,
        uvA: uv * 22, uvB: uv * 3.2, uvC: uv * 0.4,
        uvIndex: uv > 0.5 ? 'Очень высокий' : uv > 0.25 ? 'Высокий' : uv > 0.05 ? 'Средний' : 'Ночь',
      };
    }
    // RAD: мощность дозы, мкГр/сут; обратно зависит от давления (толщины атмосферы)
    rad(pressure, dt, clock) {
      if (this.sep <= 0 && Math.random() < dt / (PG.SOL * 40)) this.sep = PG.SOL * 0.8;   // солнечное событие
      this.sep = Math.max(0, this.sep - dt);
      const rate = 215 * (742 / pressure) ** 0.6 * (1 + 0.04 * this.noise.n2(clock.elapsed / 3000, 2)) + (this.sep > 0 ? 400 * this.sep / PG.SOL : 0);
      this.radDose += rate * dt / PG.SOL;
      return { rate, total: this.radDose, sep: this.sep > 0 };
    }
  };

  // ---------- питание MMRTG ----------
  PG.Power = class {
    constructor() {
      this.rtg = 88;                       // Вт эл. (2026: ~110 Вт при посадке, деградация)
      this.capacity = 2 * 42 * 28;          // Вт·ч, две Li-ion батареи
      this.soc = 0.86;
      this.loads = new Map();
    }
    set(name, watts) { if (watts) this.loads.set(name, watts); else this.loads.delete(name); }
    get draw() { let s = 0; for (const w of this.loads.values()) s += w; return s; }
    update(dt, airTemp) {
      this.set('Авионика и связь', 42);
      this.set('Обогрев', airTemp < -40 ? 36 : 0);
      const net = this.rtg - this.draw;
      this.soc = PG.clamp(this.soc + (net * dt / 3600) / this.capacity, 0, 1);
    }
    canRun(watts) { return this.soc > 0.12 || watts < 10; }
  };

  // ---------- связь с Землёй ----------
  PG.Comms = class {
    constructor() {
      this.buffer = 0;            // Мбит в бортовой памяти
      this.sent = 0;
      this.delayMode = false;     // реальная задержка команд
      this.orbiters = [
        { name: 'MRO', times: [3.35, 15.35], rate: 2.0, drift: 0 },
        { name: 'Mars Odyssey', times: [5.1, 17.1], rate: 0.256, drift: 0 },
        { name: 'MAVEN', times: [9.7], rate: 2.0, drift: 0.35 },
        { name: 'TGO', times: [12.4, 23.0], rate: 2.0, drift: -0.33 },
      ];
      this.passMin = 10 / 60;     // длительность пролёта, ч
    }
    // Земля–Марс по эллиптическим орбитам (упрощённо): расстояние и задержка света
    owlt(date = new Date()) {
      const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
      const L = (deg) => (deg * Math.PI) / 180;
      const le = L(100.464 + 0.98560910 * d), lm = L(355.433 + 0.52402068 * d);
      const rm = 1.5237 * (1 - 0.0934 ** 2) / (1 + 0.0934 * Math.cos(lm - L(336.06)));
      const ex = Math.cos(le), ez = Math.sin(le), mx = rm * Math.cos(lm), mz = rm * Math.sin(lm);
      const au = Math.hypot(mx - ex, mz - ez);
      return { au, seconds: au * 499.005 };
    }
    // ближайший пролёт орбитера относительно текущего LMST
    passes(clock) {
      const h = clock.hours, out = [];
      for (const o of this.orbiters) {
        for (const t0 of o.times) {
          let t = (t0 + o.drift * (clock.sol % 24) + 24) % 24;
          let dtH = t - h;
          if (dtH < -this.passMin) dtH += 24;
          out.push({ name: o.name, rate: o.rate, inH: dtH, active: dtH <= 0 && dtH > -this.passMin });
        }
      }
      out.sort((a, b) => a.inH - b.inH);
      return out;
    }
    // прямая связь X-диапазона: Земля над горизонтом утром
    dte(clock) { const h = clock.hours; return h > 8.5 && h < 11.5; }
    add(mbit) { this.buffer += mbit; }
    update(dt, clock, power) {
      const ps = this.passes(clock), active = ps.find((p) => p.active);
      let rate = 0;
      if (active) rate = active.rate;
      else if (this.dte(clock)) rate = 0.016;
      const moved = Math.min(this.buffer, rate * dt);
      this.buffer -= moved; this.sent += moved;
      power.set('Передатчик', rate > 0 && this.buffer > 0 ? (active ? 72 : 100) : 0);
      this.active = active ? active.name : rate > 0 ? 'HGA → DSN' : '';
      return ps;
    }
  };
})(window.PG);
