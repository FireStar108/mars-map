/* Educational traverse model. All risk weights and suit/weather limits are scenario assumptions.
 * plan(data, target) -> direct/gentle route objects, or [] when disconnected.
 * Grid cell centers are ((column + 0.5) * cellSize, (row + 0.5) * cellSize).
 * evaluate(route, weather, settings) -> route metrics plus times, risk, feasible and reasons.
 * recommend(evaluations) -> lowest-risk feasible evaluation, or null.
 * Distances/elevations use metres, times minutes, temperature Celsius, wind m/s,
 * visibility metres. settings = {limit, reserve, science}, all in minutes.
 */
(function (root) {
  'use strict';

  const MAX_SLOPE = 28;
  const BASE_SPEED = 0.65;
  const DIRECTIONS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  class MinHeap {
    constructor() { this.items = []; }
    push(item) {
      const items = this.items;
      let index = items.length;
      items.push(item);
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (items[parent].priority <= item.priority) break;
        items[index] = items[parent];
        index = parent;
      }
      items[index] = item;
    }
    pop() {
      const items = this.items;
      const first = items[0];
      const last = items.pop();
      if (!items.length) return first;
      let index = 0;
      while (index * 2 + 1 < items.length) {
        let child = index * 2 + 1;
        if (child + 1 < items.length && items[child + 1].priority < items[child].priority) child++;
        if (items[child].priority >= last.priority) break;
        items[index] = items[child];
        index = child;
      }
      items[index] = last;
      return first;
    }
  }

  function cellIndex(data, point) {
    const column = Math.floor(point.x / data.cellSize);
    const row = Math.floor(point.y / data.cellSize);
    if (column < 0 || row < 0 || column >= data.width || row >= data.height) return -1;
    return row * data.width + column;
  }

  function valid(data, index) {
    return index >= 0 && index < data.heights.length && Number.isFinite(data.heights[index]) &&
      Number.isFinite(data.slopes[index]) && data.slopes[index] <= MAX_SLOPE && data.slopes[index] >= 0;
  }

  // The nominal walking rate slows for both uphill and downhill grades.
  function gradeFactor(grade) {
    return Math.exp(-3.5 * Math.abs(grade));
  }

  function search(data, start, goal, gentle) {
    const width = data.width;
    const size = data.cellSize;
    const count = width * data.height;
    const cost = new Float64Array(count).fill(Infinity);
    const previous = new Int32Array(count).fill(-1);
    const closed = new Uint8Array(count);
    const queue = new MinHeap();
    const goalX = goal % width;
    const goalY = Math.floor(goal / width);
    cost[start] = 0;
    queue.push({ index: start, priority: 0 });

    while (queue.items.length) {
      const { index } = queue.pop();
      if (closed[index]) continue;
      if (index === goal) {
        const path = [];
        for (let cursor = goal; cursor !== -1; cursor = previous[cursor]) path.push(cursor);
        return path.reverse();
      }
      closed[index] = 1;
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [dx, dy] of DIRECTIONS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= data.height) continue;
        const next = ny * width + nx;
        if (closed[next] || !valid(data, next)) continue;
        if (dx && dy && (!valid(data, y * width + nx) || !valid(data, ny * width + x))) continue;
        const horizontal = Math.hypot(dx, dy) * size;
        const dz = data.heights[next] - data.heights[index];
        const grade = dz / horizontal;
        const alongSlope = Math.atan(Math.abs(grade)) * 180 / Math.PI;
        if (alongSlope > MAX_SLOPE) continue;
        const distance = Math.hypot(horizontal, dz);
        const slope = Math.max(data.slopes[index], data.slopes[next], alongSlope);
        const penalty = gentle ? 1 / gradeFactor(grade) + 5 * (slope / MAX_SLOPE) ** 2 : 1;
        const candidate = cost[index] + distance * penalty;
        if (candidate >= cost[next]) continue;
        cost[next] = candidate;
        previous[next] = index;
        queue.push({ index: next, priority: candidate + Math.hypot(nx - goalX, ny - goalY) * size });
      }
    }
    return null;
  }

  function makeRoute(data, path, id) {
    let distance = 0;
    let ascent = 0;
    let descent = 0;
    let steepDistance = 0;
    let maxSlope = 0;
    const segments = [];
    const points = path.map(index => ({
      x: (index % data.width + 0.5) * data.cellSize,
      y: (Math.floor(index / data.width) + 0.5) * data.cellSize,
      z: data.heights[index], slope: data.slopes[index], distance: 0,
    }));
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const horizontal = Math.hypot(b.x - a.x, b.y - a.y);
      const dz = b.z - a.z;
      const grade = dz / horizontal;
      const length = Math.hypot(horizontal, dz);
      const slope = Math.max(a.slope, b.slope, Math.atan(Math.abs(grade)) * 180 / Math.PI);
      segments.push({ length, grade, slope });
      distance += length;
      ascent += Math.max(0, dz);
      descent += Math.max(0, -dz);
      if (slope > 15) steepDistance += length;
      maxSlope = Math.max(maxSlope, slope);
      b.distance = distance;
    }
    if (points.length === 1) maxSlope = points[0].slope;
    return { id, name: id === 'direct' ? 'Short route' : 'Gentle route', points, profile: points,
      segments, distance, roundTripDistance: 2 * distance, ascent, descent, steepDistance,
      maxSlope, unknownDistance: 0, resolution: data.cellSize };
  }

  function plan(data, target) {
    if (!(data.cellSize > 0) || !(data.width > 0) || !(data.height > 0) ||
        data.heights.length !== data.width * data.height || data.slopes.length !== data.heights.length) {
      throw new Error('Invalid terrain grid');
    }
    const start = cellIndex(data, data.base);
    const goal = cellIndex(data, target);
    if (!valid(data, start) || !valid(data, goal)) return [];
    return ['direct', 'gentle'].flatMap(id => {
      const path = search(data, start, goal, id === 'gentle');
      return path ? [makeRoute(data, path, id)] : [];
    });
  }

  function evaluate(route, weather, settings) {
    const temperature = Number(weather.temperature);
    const wind = Number(weather.wind);
    const visibility = Number(weather.visibility);
    const limit = Number(settings.limit);
    const reserve = Number(settings.reserve);
    const science = Number(settings.science);
    if (![temperature, wind, visibility, limit, reserve, science].every(Number.isFinite) ||
        wind < 0 || visibility <= 0 || limit < 0 || reserve < 0 || science < 0) {
      throw new Error('Weather and time controls must contain finite values in their valid ranges');
    }
    const cold = Math.max(0, -40 - temperature);
    const weatherFactor = 1 / (1 + wind * 0.012 + cold * 0.007 + Math.max(0, 500 - visibility) / 500);
    let outbound = 0;
    let inbound = 0;
    for (const segment of route.segments) {
      const terrainFactor = 1 / (1 + segment.slope / 90);
      // Extra uphill effort applies in the opposite direction on the return leg.
      const outSpeed = BASE_SPEED * gradeFactor(segment.grade) * terrainFactor * weatherFactor /
        (1 + Math.max(0, segment.grade) * 1.2);
      const backSpeed = BASE_SPEED * gradeFactor(-segment.grade) * terrainFactor * weatherFactor /
        (1 + Math.max(0, -segment.grade) * 1.2);
      outbound += segment.length / outSpeed / 60;
      inbound += segment.length / backSpeed / 60;
    }
    const travel = outbound + inbound;
    const total = travel + science;
    const remaining = limit - total;
    const reserveSurplus = remaining - reserve;
    const steepShare = route.distance ? route.steepDistance / route.distance : 0;
    const components = {
      terrain: route.maxSlope / MAX_SLOPE * 23 + steepShare * 20,
      wind: clamp(wind / 25, 0, 1) * 15,
      cold: clamp(cold / 60, 0, 1) * 12,
      visibility: clamp((1000 - visibility) / 1000, 0, 1) * 20,
      time: reserveSurplus < 0 ? 20 + Math.min(10, -reserveSurplus / 5) : 0,
    };
    const risk = Math.round(clamp(Object.values(components).reduce((sum, value) => sum + value, 0), 0, 100));
    const blockers = [];
    if (reserveSurplus < 0) blockers.push(`Required reserve is short by ${Math.ceil(-reserveSurplus)} min.`);
    if (wind >= 25) blockers.push('Wind meets the scenario hold threshold of 25 m/s.');
    if (visibility < 100) blockers.push('Visibility is below the scenario minimum of 100 m.');
    if (temperature < -100) blockers.push('Temperature is below the scenario minimum of −100 °C.');
    const reasons = [
      `Maximum terrain slope ${route.maxSlope.toFixed(1)}°; ${Math.round(route.steepDistance)} m above 15° on each leg.`,
      `Outbound ${Math.ceil(outbound)} min, return ${Math.ceil(inbound)} min, science stop ${science} min.`,
      `Weather reduces the nominal walking rate to ${Math.round(weatherFactor * 100)}% before terrain corrections.`,
      `Remaining time ${Math.floor(remaining)} min; required reserve ${reserve} min.`,
      ...blockers,
    ];
    return { ...route, outbound, inbound, travel, total, remaining, reserveSurplus, risk,
      riskLabel: risk < 30 ? 'Low' : risk < 55 ? 'Moderate' : 'High', components,
      feasible: blockers.length === 0, blockers, reasons, weatherFactor, science, limit, reserve };
  }

  function recommend(evaluations) {
    return evaluations.filter(route => route.feasible).sort((a, b) => a.risk - b.risk || a.total - b.total)[0] || null;
  }

  root.JezeroModel = { plan, evaluate, recommend, MAX_SLOPE, BASE_SPEED };
})(typeof window === 'undefined' ? globalThis : window);
