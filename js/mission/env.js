'use strict';
// Data layers at a point and the EVA (on-foot) safety rating. Sources and models:
//  · terrain: HiRISE DTM 1 m → elevation, slope, roughness; sky-view fraction from the DTM horizon.
//  · optical: HiRISE orthoimage 25 cm → loose sand mask (dark + smooth).
//  · thermal: REMS ground/air temperature diurnal cycle at Gale, corrected for local slope/aspect.
//  · atmosphere: REMS pressure, wind, UV (PG.Weather).
//  · radiation: RAD mean surface dose rate at Gale, 0.21 mGy/day (Hassler et al. 2014, Science 343),
//    scaled with column pressure and with the sky the terrain leaves open (GCR arrives from above).
(function (PG) {
  const RAD_MEAN_UGY_DAY = 210;
  const GROUND_ALBEDO = 0.12;          // share of the dose from secondaries coming up from the ground
  const SEP_MULT = 30;                 // a strong solar particle event (RAD saw ~30× on 2024-05-20)

  // On-foot limits for a suited crew member. Apollo walked on up to ~20° slopes; NASA planning for
  // planetary EVA uses ≤15° as nominal traverse slope and treats >25° as no-go without aids.
  const LIM = {
    slopeOk: 10, slopePoor: 18, slopeNoGo: 25,
    roughOk: 0.06, roughPoor: 0.14,     // m RMS in a 5×5 m patch: knee-high relief
    sandPoor: 0.6,
  };
  PG.EVA_LIMITS = LIM;

  PG.Env = class {
    constructor(terrain, weather) {
      this.T = terrain;
      this.weather = weather;
      this.sep = 0;                     // remaining SEP event time, s
      this._n = new THREE.Vector3();
    }
    triggerSEP(seconds) { this.sep = seconds; }
    update(dt) { this.sep = Math.max(0, this.sep - dt); }

    sample(x, z, clock, sunDir, wx) {
      const T = this.T;
      const slope = T.slopeAt(x, z), rough = T.roughAt(x, z), sand = T.sandAt(x, z), svf = T.svfAt(x, z);
      const elev = T.heightAt(x, z);
      // insolation on the local slope relative to flat ground (shadowed facets get only sky light)
      const n = T.normalAt(x, z, this._n, 1.5);
      const sunUp = Math.max(0, sunDir.y);
      const flat = Math.max(0.05, sunUp), local = Math.max(0, n.dot(sunDir));
      const ins = sunUp > 0.02 ? PG.clamp(local / flat, 0, 1.8) : 1;
      // sand has low thermal inertia: hotter by day, colder by night than bedrock
      const day = Math.max(0, Math.sin(((clock.hours - 6.3) / 13.4) * Math.PI));
      const inertia = (sand - 0.5) * (day > 0 ? 6 : -5);
      const groundT = wx.ground + (wx.ground + 82) * (Math.sqrt(ins) - 1) * 0.6 + inertia;
      const sepOn = this.sep > 0;
      const shield = GROUND_ALBEDO + (1 - GROUND_ALBEDO) * svf;
      const dose = RAD_MEAN_UGY_DAY * Math.pow(742 / wx.pressure, 0.6) * shield * (sepOn ? SEP_MULT : 1) / 24.66;   // µGy/h
      return {
        x, z, elev, slope, rough, sand, svf, groundT, airT: wx.air, pressure: wx.pressure,
        wind: wx.wind, windDir: wx.windDir, uv: wx.uvIndex, dose, sep: sepOn,
      };
    }

    // Rating for walking through this point: 0 = excellent, 1 = ok, 2 = poor. Returns reasons.
    rate(s) {
      const why = [];
      let lvl = 0;
      const bump = (l, msg) => { lvl = Math.max(lvl, l); why.push({ l, msg }); };
      if (s.slope > LIM.slopeNoGo) bump(2, `Slope ${s.slope.toFixed(0)}° — no-go on foot`);
      else if (s.slope > LIM.slopePoor) bump(2, `Slope ${s.slope.toFixed(0)}° — too steep for a suited walker`);
      else if (s.slope > LIM.slopeOk) bump(1, `Slope ${s.slope.toFixed(0)}° — slow, tiring`);
      if (s.rough > LIM.roughPoor) bump(2, `Rough ground (${(s.rough * 100).toFixed(0)} cm relief) — trip and fall risk`);
      else if (s.rough > LIM.roughOk) bump(1, `Uneven ground (${(s.rough * 100).toFixed(0)} cm relief)`);
      if (s.sand > LIM.sandPoor) bump(1, 'Loose sand — boots sink, rover may slip');
      if (s.sep) bump(2, 'Solar particle event — get to shelter');
      return { lvl, why };
    }
  };

  // Walking speed on a slope (m/s) for a suited astronaut: Tobler's hiking function scaled to
  // ~1 m/s on the flat (Apollo 15–17 averaged 0.7–1.1 m/s in suits).
  PG.walkSpeed = function (gradeSigned) {
    return 1.0 * Math.exp(-3.5 * Math.abs(gradeSigned + 0.05)) / Math.exp(-3.5 * 0.05);
  };

  // Metabolic rate in a suit, W: Apollo EVAs averaged ~240–300 W; climbing adds roughly 30 W per degree.
  PG.metabolicW = function (gradeSigned, speed) {
    const deg = Math.atan(gradeSigned) / PG.DEG;
    return 180 + 90 * speed + Math.max(0, deg) * 28 + Math.max(0, -deg) * 6;
  };

  PG.LEVEL = [
    { key: 'excellent', name: 'Excellent', color: '#7dff8a' },
    { key: 'ok', name: 'So-so', color: '#ffc94f' },
    { key: 'poor', name: 'Poor', color: '#ff4f5e' },
  ];
})(window.PG);
