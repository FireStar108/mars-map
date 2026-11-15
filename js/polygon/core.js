'use strict';
// Полигон: общее пространство имён, математика, шум, ввод, марсианское время.
window.PG = window.PG || {};
(function (PG) {
  PG.G_MARS = 3.721;               // м/с²
  PG.SOL = 88775.244;              // длительность сола, с
  PG.ROVER_TOP_SPEED = 0.04;       // м/с — паспортная скорость Curiosity

  PG.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  PG.lerp = (a, b, t) => a + (b - a) * t;
  // экспоненциальное сглаживание, не зависящее от частоты кадров
  PG.damp = (a, b, lambda, dt) => b + (a - b) * Math.exp(-lambda * dt);
  PG.wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  PG.approach = (v, target, maxDelta) =>
    v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target);
  PG.DEG = Math.PI / 180;

  PG.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Градиентный шум Перлина 2D + fbm.
  PG.Noise = class {
    constructor(seed) {
      const r = PG.rng(seed);
      const p = new Uint8Array(256);
      for (let i = 0; i < 256; i++) p[i] = i;
      for (let i = 255; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const t = p[i]; p[i] = p[j]; p[j] = t;
      }
      this.perm = new Uint8Array(512);
      for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    }
    grad(h, x, y) {
      switch (h & 7) {
        case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
        case 4: return x; case 5: return -x; case 6: return y; default: return -y;
      }
    }
    n2(x, y) {
      const P = this.perm;
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const X = xi & 255, Y = yi & 255;
      const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
      const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
      const aa = P[P[X] + Y], ab = P[P[X] + Y + 1], ba = P[P[X + 1] + Y], bb = P[P[X + 1] + Y + 1];
      const x1 = PG.lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u);
      const x2 = PG.lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u);
      return PG.lerp(x1, x2, v);   // ≈ [-1, 1]
    }
    fbm(x, y, oct = 4, lac = 2, gain = 0.5) {
      let s = 0, a = 1, f = 1, n = 0;
      for (let i = 0; i < oct; i++) { s += a * this.n2(x * f, y * f); n += a; a *= gain; f *= lac; }
      return s / n;
    }
  };

  // Клавиатура: удержание + фронт нажатия.
  PG.Input = class {
    constructor() {
      this.down = new Set();
      this.hit = new Set();
      addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
        if (!this.down.has(e.code)) this.hit.add(e.code);
        this.down.add(e.code);
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      });
      addEventListener('keyup', (e) => this.down.delete(e.code));
      addEventListener('blur', () => this.down.clear());
    }
    is(...codes) { return codes.some((c) => this.down.has(c)); }
    pressed(code) { return this.hit.has(code); }
    endFrame() { this.hit.clear(); }
    axis(neg, pos) { return (this.is(...pos) ? 1 : 0) - (this.is(...neg) ? 1 : 0); }
  };

  // Простая шина событий.
  PG.Bus = class {
    constructor() { this.map = new Map(); }
    on(name, fn) { (this.map.get(name) || this.map.set(name, []).get(name)).push(fn); }
    emit(name, data) { (this.map.get(name) || []).forEach((fn) => fn(data)); }
  };

  // Марсианские часы: сол миссии Curiosity и местное среднее солнечное время (LMST).
  PG.MarsClock = class {
    constructor(startLmstHours) {
      const landing = Date.UTC(2012, 7, 6, 5, 17, 57);       // посадка Curiosity, UTC
      const sols = (Date.now() - landing) / 1000 / PG.SOL;
      this.sol = Math.floor(sols);
      this.t = startLmstHours / 24.0 * PG.SOL;             // секунды от полуночи LMST
      this.elapsed = 0;                                    // сим-время с начала сессии
    }
    advance(dt) {
      this.elapsed += dt;
      this.t += dt;
      while (this.t >= PG.SOL) { this.t -= PG.SOL; this.sol++; }
    }
    get hours() { return (this.t / PG.SOL) * 24; }
    lmst() {
      const h = this.hours;
      const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.floor(((h - hh) * 60 - mm) * 60);
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }
    // Солнце для широты кратера Гейл (−4.6°), сезон: Ls ≈ 150 (упрощённо).
    sunDir(out) {
      const lat = -4.6 * PG.DEG, dec = 10 * PG.DEG;
      const ha = (this.hours / 24) * 2 * Math.PI - Math.PI;
      const alt = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
      const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));
      // мир: −Z = север, +X = восток
      out.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
      return out;
    }
  };

  PG.fmtDur = function (sec) {
    sec = Math.max(0, sec);
    if (sec < 60) return `${sec.toFixed(0)} с`;
    if (sec < 3600) return `${Math.floor(sec / 60)} мин ${String(Math.floor(sec % 60)).padStart(2, '0')} с`;
    return `${Math.floor(sec / 3600)} ч ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')} мин`;
  };

  PG.base64ToBuffer = function (b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  };

  PG.loadGLB = function (name) {
    return new Promise((resolve, reject) => {
      const data = window.MODELS && window.MODELS[name];
      if (!data) { reject(new Error(`модель ${name} не загружена`)); return; }
      new GLTFLoader().parse(PG.base64ToBuffer(data), '', resolve, reject);
    });
  };
})(window.PG);
