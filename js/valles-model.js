/* Educational traverse model. All risk weights and suit/weather limits are scenario assumptions.
 * plan(data, target, weather, field) -> direct/adaptive route objects, or [] when disconnected.
 * Grid cell centers are ((column + 0.5) * cellSize, (row + 0.5) * cellSize).
 * evaluate(route, weather, settings) -> route metrics plus times, risk, feasible and reasons.
 * recommend(evaluations) -> lowest-risk feasible evaluation, or null.
 * Distances/elevations use metres, times minutes, temperature Celsius, wind m/s,
 * visibility metres. settings = {limit, reserve, science}, all in minutes.
 */
(function (root) {
  "use strict";

  const MAX_SLOPE = 28;
  const BASE_SPEED = 0.65;
  const DIRECTIONS = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  class MinHeap {
    constructor() {
      this.items = [];
    }
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
        if (
          child + 1 < items.length &&
          items[child + 1].priority < items[child].priority
        )
          child++;
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
    if (column < 0 || row < 0 || column >= data.width || row >= data.height)
      return -1;
    return row * data.width + column;
  }

  function valid(data, index) {
    return (
      index >= 0 &&
      index < data.heights.length &&
      Number.isFinite(data.heights[index]) &&
      Number.isFinite(data.slopes[index]) &&
      data.slopes[index] <= MAX_SLOPE &&
      data.slopes[index] >= 0
    );
  }

  // The nominal walking rate slows for both uphill and downhill grades.
  function gradeFactor(grade) {
    return Math.exp(-3.5 * Math.abs(grade));
  }

  function search(data, start, goal, gentle, field) {
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
        for (let cursor = goal; cursor !== -1; cursor = previous[cursor])
          path.push(cursor);
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
        if (
          gentle &&
          (blocked(field.cells[next]) || blocked(field.cells[index]))
        )
          continue;
        if (
          dx &&
          dy &&
          (!valid(data, y * width + nx) ||
            !valid(data, ny * width + x) ||
            (gentle &&
              (blocked(field.cells[y * width + nx]) ||
                blocked(field.cells[ny * width + x]))))
        )
          continue;
        const horizontal = Math.hypot(dx, dy) * size;
        const dz = data.heights[next] - data.heights[index];
        const grade = dz / horizontal;
        const alongSlope = (Math.atan(Math.abs(grade)) * 180) / Math.PI;
        if (alongSlope > MAX_SLOPE) continue;
        const distance = Math.hypot(horizontal, dz);
        const slope = Math.max(
          data.slopes[index],
          data.slopes[next],
          alongSlope,
        );
        const stats = edge(
          { length: distance, grade, slope },
          field.cells[index],
          field.cells[next],
        );
        const penalty = gentle ? stats.score / distance : 1;
        const candidate = cost[index] + distance * penalty;
        if (candidate >= cost[next]) continue;
        cost[next] = candidate;
        previous[next] = index;
        queue.push({
          index: next,
          priority: candidate + Math.hypot(nx - goalX, ny - goalY) * size,
        });
      }
    }
    return null;
  }

  function makeRoute(data, path, id, field) {
    let distance = 0;
    let ascent = 0;
    let descent = 0;
    let steepDistance = 0;
    let maxSlope = 0;
    const segments = [];
    const points = path.map((index) => ({
      x: ((index % data.width) + 0.5) * data.cellSize,
      y: (Math.floor(index / data.width) + 0.5) * data.cellSize,
      index,
      z: data.heights[index],
      slope: data.slopes[index],
      distance: 0,
    }));
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const horizontal = Math.hypot(b.x - a.x, b.y - a.y);
      const dz = b.z - a.z;
      const grade = dz / horizontal;
      const length = Math.hypot(horizontal, dz);
      const slope = Math.max(
        a.slope,
        b.slope,
        (Math.atan(Math.abs(grade)) * 180) / Math.PI,
      );
      segments.push({ length, grade, slope, a: a.index, b: b.index });
      distance += length;
      ascent += Math.max(0, dz);
      descent += Math.max(0, -dz);
      if (slope > 15) steepDistance += length;
      maxSlope = Math.max(maxSlope, slope);
      b.distance = distance;
    }
    if (points.length === 1) maxSlope = points[0].slope;
    return {
      id,
      name: id === "direct" ? "Short route" : "Adaptive route",
      points,
      profile: points,
      field,
      segments,
      distance,
      roundTripDistance: 2 * distance,
      ascent,
      descent,
      steepDistance,
      maxSlope,
      unknownDistance: 0,
      resolution: data.cellSize,
    };
  }

  function plan(
    data,
    target,
    weather = {},
    field = root.MarsWeather.localField(data, weather),
  ) {
    if (
      !(data.cellSize > 0) ||
      !(data.width > 0) ||
      !(data.height > 0) ||
      data.heights.length !== data.width * data.height ||
      data.slopes.length !== data.heights.length
    ) {
      throw new Error("Invalid terrain grid");
    }
    const start = cellIndex(data, data.base);
    const goal = cellIndex(data, target);
    if (!valid(data, start) || !valid(data, goal)) return [];
    return ["direct", "gentle"].flatMap((id) => {
      const path = search(data, start, goal, id === "gentle", field);
      return path ? [makeRoute(data, path, id, field)] : [];
    });
  }

  function blocked(w) {
    return (
      !w ||
      !!w.hazardMask ||
      w.wind >= 30 ||
      w.visibility < 100 ||
      w.temperature < -100
    );
  }

  function edge(segment, a, b) {
    const penalty = (a.penalty + b.penalty) / 2;
    const terrain =
      Math.exp(3.5 * Math.abs(segment.grade)) * (1 + segment.slope / 90);
    const out =
      (segment.length / BASE_SPEED / 60) *
      terrain *
      penalty *
      (1 + 1.2 * Math.max(0, segment.grade));
    const back =
      (segment.length / BASE_SPEED / 60) *
      terrain *
      penalty *
      (1 + 1.2 * Math.max(0, -segment.grade));
    const hazard =
      1 +
      2.5 * ((a.dust + b.dust) / 2) +
      0.045 * ((a.wind + b.wind) / 2) +
      2 * (segment.slope / MAX_SLOPE) ** 2 +
      (1.5 * ((a.hazardLevel || 0) + (b.hazardLevel || 0))) / 2;
    return {
      out,
      back,
      score: (((out + back) * BASE_SPEED * 60) / 2) * hazard,
      penalty,
    };
  }

  function evaluate(route, weather, settings, field = route.field) {
    const { limit, reserve, science } = settings;
    if (![limit, reserve, science].every((v) => Number.isFinite(v) && v >= 0))
      throw new Error("Invalid time budget");
    let hazardMask = 0,
      hazardPeak = 0,
      hazardDistance = 0;
    const hazardPeaks = { sand: 0, rocks: 0, rockfall: 0, cold: 0, solar: 0 };
    let outbound = 0,
      inbound = 0,
      score = 0,
      windSum = 0,
      dustSum = 0,
      penaltySum = 0,
      maxWind = 0,
      minVisibility = Infinity,
      minTemperature = Infinity;
    for (const point of route.points) {
      const w = field.cells[point.index];
      maxWind = Math.max(maxWind, w.wind);
      minVisibility = Math.min(minVisibility, w.visibility);
      minTemperature = Math.min(minTemperature, w.temperature);
      hazardMask |= w.hazardMask || 0;
      hazardPeak = Math.max(hazardPeak, w.hazardLevel || 0);
      if (field.hazards) {
        const h = root.MarsHazards.values(field.hazards, point.index);
        for (const k of Object.keys(hazardPeaks))
          hazardPeaks[k] = Math.max(hazardPeaks[k], h[k]);
      }
    }
    for (const segment of route.segments) {
      const a = field.cells[segment.a],
        b = field.cells[segment.b],
        stats = edge(segment, a, b);
      if (a.hazardMask || b.hazardMask) hazardDistance += segment.length;
      outbound += stats.out;
      inbound += stats.back;
      score += stats.score;
      windSum += ((a.wind + b.wind) / 2) * segment.length;
      dustSum += ((a.dust + b.dust) / 2) * segment.length;
      penaltySum += stats.penalty * segment.length;
    }
    const averageWind = route.distance ? windSum / route.distance : maxWind;
    const averageDust = route.distance
      ? dustSum / route.distance
      : field.cells[route.points[0].index].dust;
    const travel = outbound + inbound,
      total = travel + science,
      remaining = limit - total,
      reserveSurplus = remaining - reserve;
    const components = {
      terrain:
        (route.maxSlope / MAX_SLOPE) * 20 +
        (route.distance ? route.steepDistance / route.distance : 0) * 15,
      wind: clamp(averageWind / 30, 0, 1) * 20,
      cold: clamp((-40 - minTemperature) / 60, 0, 1) * 10,
      dust: averageDust * 20,
      visibility: clamp((600 - minVisibility) / 600, 0, 1) * 15,
      time: reserveSurplus < 0 ? 25 : 0,
      hazards: hazardPeak * 25,
    };
    const risk = Math.round(
      clamp(
        Object.values(components).reduce((a, b) => a + b, 0),
        0,
        100,
      ),
    );
    const blockers = root.MarsHazards
      ? root.MarsHazards.reasons(hazardMask)
      : [];
    if (reserveSurplus < 0)
      blockers.push(`Reserve short by ${Math.ceil(-reserveSurplus)} min.`);
    if (maxWind >= 30)
      blockers.push("Local modeled wind reaches the 30 m/s scenario hold.");
    if (minVisibility < 100)
      blockers.push("Local visibility falls below the 100 m scenario limit.");
    if (minTemperature < -100)
      blockers.push("Local temperature falls below −100 °C.");
    const reasons = [
      `Maximum terrain slope ${route.maxSlope.toFixed(1)}°; ${Math.round(route.steepDistance)} m above 15° per leg.`,
      `Outbound ${Math.ceil(outbound)} min; return ${Math.ceil(inbound)} min; science ${science} min.`,
      `Peak local wind ${maxWind.toFixed(1)} m/s; minimum visibility ${Math.round(minVisibility)} m.`,
      `Remaining ${Math.floor(remaining)} min; reserve ${reserve} min.`,
      ...blockers,
    ];
    // Do not duplicate the full field inside exported or saved route comparisons.
    const { field: ignored, ...geometry } = route;
    return {
      ...geometry,
      hazardMask,
      hazardPeak,
      hazardPeaks,
      hazardDistance,
      outbound,
      inbound,
      travel,
      total,
      remaining,
      reserveSurplus,
      risk,
      score,
      components,
      maxWind,
      minVisibility,
      minTemperature,
      averageWind,
      averageDust,
      riskLabel: risk < 30 ? "Low" : risk < 55 ? "Moderate" : "High",
      feasible: !blockers.length,
      blockers,
      reasons,
      weatherFactor: route.distance ? route.distance / penaltySum : 1,
      science,
      limit,
      reserve,
    };
  }

  function recommend(evaluations) {
    return (
      evaluations
        .filter((route) => route.feasible)
        .sort((a, b) => a.score - b.score || a.total - b.total)[0] || null
    );
  }

  root.VallesModel = {
    plan,
    evaluate,
    recommend,
    MAX_SLOPE,
    BASE_SPEED,
    edge,
    blocked,
    cellIndex,
  };
})(typeof window === "undefined" ? globalThis : window);
