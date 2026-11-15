/* Global educational route comparison on a spherical Mars (radius 3396.19 km).
 * create({width,height,heights}, events) returns {sample,plan}.
 * Source cells span -180..180 longitude and +90..-90 latitude, at cell centers.
 * Events are {lat,lon,ls}. Seasonal counts use a 5 degree radius and +/-45 degrees Ls.
 * Counts describe this catalogue's observations, without a probability interpretation.
 * Radiation is exp(elevation / 10800), a relative atmospheric-shielding proxy.
 * It has no dose units and is not a calibrated radiation transport calculation.
 */
(function (root) {
  "use strict";
  const RAD = Math.PI / 180;
  const RADIUS = 3396.19;
  const WIDTH = 360;
  const HEIGHT = 180;
  const COUNT = WIDTH * HEIGHT;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const wrap = (value, period) => ((value % period) + period) % period;
  const longitude = (value) => wrap(value + 180, 360) - 180;
  const seasonDifference = (a, b) => Math.abs(longitude(a - b));

  function position(point) {
    if (
      !point ||
      !Number.isFinite(point.lat) ||
      !Number.isFinite(point.lon) ||
      Math.abs(point.lat) > 90
    ) {
      throw new Error(
        "Choose a finite latitude between −90° and 90° and a finite longitude.",
      );
    }
    return { lat: point.lat, lon: longitude(point.lon) };
  }

  function angularDistance(a, b) {
    const latitude = (b.lat - a.lat) * RAD;
    const lon = longitude(b.lon - a.lon) * RAD;
    const haversine =
      Math.sin(latitude / 2) ** 2 +
      Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(lon / 2) ** 2;
    return (
      2 *
      Math.atan2(
        Math.sqrt(clamp(haversine, 0, 1)),
        Math.sqrt(clamp(1 - haversine, 0, 1)),
      )
    );
  }

  function vector(point) {
    const latitude = point.lat * RAD;
    const lon = point.lon * RAD;
    return [
      Math.cos(latitude) * Math.cos(lon),
      Math.cos(latitude) * Math.sin(lon),
      Math.sin(latitude),
    ];
  }

  function geodesic(start, end) {
    const angle = angularDistance(start, end);
    if (angle < 1e-12) return [start];
    const a = vector(start);
    const b = vector(end);
    const cosine = Math.cos(angle);
    let tangent = b.map((value, i) => value - cosine * a[i]);
    let norm = Math.hypot(...tangent);
    if (norm < 1e-10) {
      // Exactly antipodal endpoints admit many great circles. Choose one deterministically.
      const axis = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const dot = axis.reduce((sum, value, i) => sum + value * a[i], 0);
      tangent = axis.map((value, i) => value - dot * a[i]);
      norm = Math.hypot(...tangent);
    }
    tangent = tangent.map((value) => value / norm);
    const steps = Math.max(1, Math.ceil(angle / (RAD * 0.5)));
    const points = [start];
    for (let i = 1; i < steps; i++) {
      const phase = (angle * i) / steps;
      const v = a.map(
        (value, axis) =>
          value * Math.cos(phase) + tangent[axis] * Math.sin(phase),
      );
      points.push({
        lat: Math.atan2(v[2], Math.hypot(v[0], v[1])) / RAD,
        lon: longitude(Math.atan2(v[1], v[0]) / RAD),
      });
    }
    points.push(end);
    return points;
  }

  class MinHeap {
    constructor() {
      this.items = [];
    }
    push(item) {
      let index = this.items.length;
      this.items.push(item);
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (this.items[parent].priority <= item.priority) break;
        this.items[index] = this.items[parent];
        index = parent;
      }
      this.items[index] = item;
    }
    pop() {
      const first = this.items[0];
      const last = this.items.pop();
      if (!this.items.length) return first;
      let index = 0;
      while (2 * index + 1 < this.items.length) {
        let child = 2 * index + 1;
        if (
          child + 1 < this.items.length &&
          this.items[child + 1].priority < this.items[child].priority
        )
          child++;
        if (this.items[child].priority >= last.priority) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
      return first;
    }
  }

  function gridPoint(index) {
    return {
      lat: 89.5 - Math.floor(index / WIDTH),
      lon: (index % WIDTH) - 179.5,
    };
  }

  function gridIndex(point) {
    return (
      clamp(Math.floor(90 - point.lat), 0, HEIGHT - 1) * WIDTH +
      clamp(Math.floor(longitude(point.lon) + 180), 0, WIDTH - 1)
    );
  }

  function create(data, eventInput) {
    if (
      !data ||
      !Number.isInteger(data.width) ||
      !Number.isInteger(data.height) ||
      data.width < 2 ||
      data.height < 2 ||
      !data.heights ||
      data.heights.length !== data.width * data.height
    ) {
      throw new Error("A complete global elevation grid is required.");
    }
    const rawEvents = Array.isArray(eventInput)
      ? eventInput
      : eventInput?.events;
    const events = (rawEvents || [])
      .filter(
        (event) =>
          Number.isFinite(event.lat) &&
          Number.isFinite(event.lon) &&
          Number.isFinite(event.ls) &&
          Math.abs(event.lat) <= 90,
      )
      .map((event) => ({
        ...event,
        lat: event.lat,
        lon: longitude(event.lon),
        ls: wrap(event.ls, 360),
      }));
    const dustAvailable = events.length > 0;
    const radiation = new Float32Array(COUNT);
    const elevation = new Float32Array(COUNT);
    let seasonCache = null;
    let weatherCache = null;

    function elevationAt(point) {
      const sourceX = wrap(
        ((longitude(point.lon) + 180) / 360) * data.width - 0.5,
        data.width,
      );
      const sourceY = clamp(
        ((90 - point.lat) / 180) * data.height - 0.5,
        0,
        data.height - 1,
      );
      const x0 = Math.floor(sourceX);
      const y0 = Math.floor(sourceY);
      const x1 = (x0 + 1) % data.width;
      const y1 = Math.min(y0 + 1, data.height - 1);
      const values = [
        data.heights[y0 * data.width + x0],
        data.heights[y0 * data.width + x1],
        data.heights[y1 * data.width + x0],
        data.heights[y1 * data.width + x1],
      ];
      if (!values.every(Number.isFinite)) return null;
      const tx = sourceX - x0;
      const ty = sourceY - y0;
      return (
        (values[0] * (1 - tx) + values[1] * tx) * (1 - ty) +
        (values[2] * (1 - tx) + values[3] * tx) * ty
      );
    }

    for (let index = 0; index < COUNT; index++) {
      const z = elevationAt(gridPoint(index));
      elevation[index] = z === null ? NaN : z;
      radiation[index] = z === null ? NaN : Math.exp(z / 10800);
    }

    function seasonGrid(ls) {
      const season = wrap(ls, 360);
      if (seasonCache?.ls === season) return seasonCache;
      const counts = new Uint32Array(COUNT);
      let selectedEvents = 0;
      let maximum = 0;
      for (const event of events) {
        if (seasonDifference(event.ls, season) > 45) continue;
        selectedEvents++;
        const firstRow = clamp(Math.floor(90 - event.lat - 5), 0, HEIGHT - 1);
        const lastRow = clamp(Math.floor(90 - event.lat + 5), 0, HEIGHT - 1);
        // A conservative longitude bound includes every point within the spherical cap.
        const extremeLat = Math.min(90, Math.abs(event.lat) + 5);
        const span =
          extremeLat >= 89
            ? 180
            : Math.min(180, 5 / Math.cos(extremeLat * RAD) + 1);
        const centerColumn = Math.floor(event.lon + 180);
        const firstColumn = span === 180 ? 0 : centerColumn - Math.ceil(span);
        const lastColumn =
          span === 180 ? WIDTH - 1 : centerColumn + Math.ceil(span);
        for (let row = firstRow; row <= lastRow; row++) {
          for (let column = firstColumn; column <= lastColumn; column++) {
            const index = row * WIDTH + wrap(column, WIDTH);
            if (angularDistance(event, gridPoint(index)) > 5 * RAD) continue;
            counts[index]++;
            maximum = Math.max(maximum, counts[index]);
          }
        }
      }
      const normalized = new Float32Array(COUNT);
      if (maximum > 0)
        for (let index = 0; index < COUNT; index++)
          normalized[index] = counts[index] / maximum;
      seasonCache = { ls: season, counts, normalized, maximum, selectedEvents };
      return seasonCache;
    }

    function sample(lat, lon, ls = 90) {
      if (!Number.isFinite(ls))
        throw new Error("Season must be a finite solar longitude.");
      const point = position({ lat, lon });
      const index = gridIndex(point);
      const grid = seasonGrid(ls);
      const z = elevationAt(point);
      return {
        elevation: z,
        radiationRelative: z === null ? null : Math.exp(z / 10800),
        dustCount: dustAvailable ? grid.counts[index] : null,
        dustNormalized: dustAvailable ? grid.normalized[index] : null,
        dustAvailable,
        selectedEvents: grid.selectedEvents,
        seasonalMaximum: grid.maximum,
        evaluationResolutionDegrees: 1,
      };
    }

    function weatherGrid(input, hazardInput) {
      const weather = root.MarsWeather.normalize(input),
        key = JSON.stringify([weather, hazardInput]);
      if (weatherCache?.key === key) return weatherCache;
      const hazardField = root.MarsHazards?.globalField(
        elevation,
        hazardInput ?? { enabled: false },
        WIDTH,
        HEIGHT,
      );
      const cells = Array.from({ length: COUNT }, (_, i) => {
        const p = gridPoint(i);
        const w = root.MarsWeather.globalAt(weather, p.lat, p.lon);
        return hazardField ? root.MarsHazards.apply(w, hazardField, i) : w;
      });
      weatherCache = { key, weather, cells, hazardField };
      return weatherCache;
    }
    function cellHold(w) {
      return (
        !!w.hazardMask ||
        w.wind >= 50 ||
        w.visibility < 100 ||
        w.temperature < -100
      );
    }
    function edgeStats(a, b, grid, scenario, dustWeight, radiationWeight) {
      const wa = scenario.cells[a],
        wb = scenario.cells[b];
      const penalty = (wa.penalty + wb.penalty) / 2;
      const dust = (grid.normalized[a] + grid.normalized[b]) / 2;
      const rad = (radiation[a] + radiation[b]) / 2;
      return {
        penalty,
        cost:
          penalty *
          (1 +
            dustWeight * dust +
            radiationWeight * rad +
            (1.5 * ((wa.hazardLevel || 0) + (wb.hazardLevel || 0))) / 2),
        hold: cellHold(wa) || cellHold(wb),
      };
    }

    function weightedPath(
      start,
      end,
      grid,
      dustWeight,
      radiationWeight,
      scenario,
    ) {
      const first = gridIndex(start);
      const last = gridIndex(end);
      if (
        !Number.isFinite(radiation[first]) ||
        !Number.isFinite(radiation[last])
      )
        return null;
      if (cellHold(scenario.cells[first]) || cellHold(scenario.cells[last]))
        return null;
      const costs = new Float64Array(COUNT).fill(Infinity);
      const previous = new Int32Array(COUNT).fill(-1);
      const closed = new Uint8Array(COUNT);
      const queue = new MinHeap();
      costs[first] = 0;
      queue.push({ index: first, priority: 0 });
      const goalPoint = gridPoint(last);
      while (queue.items.length) {
        const { index } = queue.pop();
        if (closed[index]) continue;
        if (index === last) {
          const points = [];
          for (let cursor = last; cursor !== -1; cursor = previous[cursor])
            points.push(gridPoint(cursor));
          return [start, ...points.reverse(), end];
        }
        closed[index] = 1;
        const row = Math.floor(index / WIDTH);
        const column = index % WIDTH;
        const point = gridPoint(index);
        const neighbors = [];
        for (let dy = -1; dy <= 1; dy++) {
          const nextRow = row + dy;
          if (nextRow < 0 || nextRow >= HEIGHT) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            neighbors.push(nextRow * WIDTH + wrap(column + dx, WIDTH));
          }
        }
        // Join opposite meridians across each pole instead of circling the polar row.
        if (row === 0 || row === HEIGHT - 1)
          neighbors.push(row * WIDTH + wrap(column + 180, WIDTH));
        for (const next of neighbors) {
          if (closed[next] || !Number.isFinite(radiation[next])) continue;
          const nr = Math.floor(next / WIDTH),
            nc = next % WIDTH;
          const dc = Math.min(
            wrap(nc - column, WIDTH),
            wrap(column - nc, WIDTH),
          );
          if (
            Math.abs(nr - row) === 1 &&
            dc === 1 &&
            (cellHold(scenario.cells[row * WIDTH + nc]) ||
              cellHold(scenario.cells[nr * WIDTH + column]))
          )
            continue;
          const neighbor = gridPoint(next);
          const distance = angularDistance(point, neighbor) * RADIUS;
          const dust = (grid.normalized[index] + grid.normalized[next]) / 2;
          const rad = (radiation[index] + radiation[next]) / 2;
          const stats = edgeStats(
            index,
            next,
            grid,
            scenario,
            dustWeight,
            radiationWeight,
          );
          if (stats.hold) continue;
          const candidate = costs[index] + distance * stats.cost;
          if (candidate >= costs[next]) continue;
          costs[next] = candidate;
          previous[next] = index;
          queue.push({
            index: next,
            priority: candidate + angularDistance(neighbor, goalPoint) * RADIUS,
          });
        }
      }
      return null;
    }

    function analyze(points, id, grid, options, scenario) {
      let hazardMask = 0,
        hazardPeak = 0,
        hazardBlockedKm = 0,
        minTemperature = Infinity;
      const hazardPeaks = { sand: 0, rocks: 0, rockfall: 0, cold: 0, solar: 0 };
      let distanceKm = 0;
      let dustIntegralKm = 0;
      let radiationIntegralKm = 0;
      let unknownKm = 0;
      let maxElevation = -Infinity;
      let weightedCost = 0,
        travelHours = 0,
        scenarioDust = 0,
        maxWind = 0,
        minVisibility = Infinity,
        hold = false;
      const samples = points.map((point) => {
        const z = elevationAt(point);
        if (z !== null) maxElevation = Math.max(maxElevation, z);
        const w = scenario.cells[gridIndex(point)];
        maxWind = Math.max(maxWind, w.wind);
        minVisibility = Math.min(minVisibility, w.visibility);
        if (cellHold(w)) hold = true;
        minTemperature = Math.min(minTemperature, w.temperature);
        hazardMask |= w.hazardMask || 0;
        hazardPeak = Math.max(hazardPeak, w.hazardLevel || 0);
        if (scenario.hazardField) {
          const h = root.MarsHazards.values(
            scenario.hazardField,
            gridIndex(point),
          );
          for (const k of Object.keys(hazardPeaks))
            hazardPeaks[k] = Math.max(hazardPeaks[k], h[k]);
        }
        return { ...point, elevation: z };
      });
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1];
        const b = samples[i];
        const distance = angularDistance(a, b) * RADIUS;
        const first = gridIndex(a);
        const last = gridIndex(b);
        distanceKm += distance;
        if (scenario.cells[first].hazardMask || scenario.cells[last].hazardMask)
          hazardBlockedKm += distance;
        const stats = edgeStats(
          first,
          last,
          grid,
          scenario,
          options.dustWeight,
          options.radiationWeight,
        );
        weightedCost += distance * stats.cost;
        travelHours += (distance / options.speed) * stats.penalty;
        hold ||= stats.hold;
        scenarioDust +=
          (distance *
            (scenario.cells[first].dust + scenario.cells[last].dust)) /
          2;
        dustIntegralKm +=
          (distance * (grid.normalized[first] + grid.normalized[last])) / 2;
        if (a.elevation === null || b.elevation === null) unknownKm += distance;
        else
          radiationIntegralKm +=
            (distance *
              (Math.exp(a.elevation / 10800) + Math.exp(b.elevation / 10800))) /
            2;
      }
      const known =
        unknownKm === 0 && samples.every((point) => point.elevation !== null);
      const initialRadiation =
        samples[0].elevation === null
          ? null
          : Math.exp(samples[0].elevation / 10800);
      const blockers = root.MarsHazards
        ? root.MarsHazards.reasons(hazardMask)
        : [];
      if (maxWind >= 50)
        blockers.push("Scenario wind reaches the 50 m/s vehicle hold.");
      if (minVisibility < 100)
        blockers.push("Scenario visibility is below 100 m.");
      if (minTemperature < -100 && !(hazardMask & 8))
        blockers.push("Scenario temperature is below −100 °C.");
      if (!known) blockers.push("Elevation data is incomplete.");
      return {
        hazardMask,
        hazardPeak,
        hazardPeaks,
        hazardBlockedKm,
        minTemperature,
        blockers,
        id,
        points: samples,
        distanceKm,
        sols: travelHours / options.hoursPerSol,
        feasible: known && !hold,
        maxWind,
        minVisibility,
        scenarioDust: distanceKm
          ? scenarioDust / distanceKm
          : scenario.cells[gridIndex(samples[0])].dust,
        dustExposure: dustAvailable
          ? distanceKm
            ? dustIntegralKm / distanceKm
            : grid.normalized[gridIndex(samples[0])]
          : null,
        radiationExposure: known
          ? distanceKm
            ? radiationIntegralKm / distanceKm
            : initialRadiation
          : null,
        dustIntegralKm: dustAvailable ? dustIntegralKm : null,
        radiationIntegralKm: known ? radiationIntegralKm : null,
        maxElevation: maxElevation === -Infinity ? null : maxElevation,
        score: known ? weightedCost : null,
        unknownKm,
        dustAvailable,
        elevationComplete: known,
        status: !known
          ? "incomplete-elevation"
          : hold
            ? "scenario-hold"
            : "modeled",
      };
    }

    function plan(startInput, endInput, settings = {}) {
      const start = position(startInput);
      const end = position(endInput);
      const options = {
        ls: 90,
        dustWeight: 2,
        radiationWeight: 1,
        speed: 20,
        hoursPerSol: 8,
        ...settings,
      };
      if (
        ![
          options.ls,
          options.dustWeight,
          options.radiationWeight,
          options.speed,
          options.hoursPerSol,
        ].every(Number.isFinite) ||
        options.dustWeight < 0 ||
        options.radiationWeight < 0 ||
        options.speed <= 0 ||
        options.hoursPerSol <= 0 ||
        options.hoursPerSol > 24.66
      ) {
        throw new Error(
          "Use nonnegative weights, positive speed, and 0–24.66 travel hours per sol.",
        );
      }
      const grid = seasonGrid(options.ls);
      const scenario = weatherGrid(options.weather, options.hazards);
      const baseline = geodesic(start, end);
      const candidate =
        baseline.length === 1
          ? baseline
          : weightedPath(
              start,
              end,
              grid,
              options.dustWeight,
              options.radiationWeight,
              scenario,
            );
      const routes = [analyze(baseline, "short", grid, options, scenario)];
      if (candidate)
        routes.push(analyze(candidate, "aware", grid, options, scenario));
      const available = routes.filter(
        (route) => route.score !== null && route.feasible,
      );
      available.sort(
        (a, b) => a.score - b.score || a.distanceKm - b.distanceKm,
      );
      return {
        routes,
        recommendedId: available[0]?.id || null,
        dustAvailable,
        selectedEvents: grid.selectedEvents,
        seasonalMaximum: grid.maximum,
        model: {
          radiusKm: RADIUS,
          sourceResolutionDegrees: 360 / data.width,
          routingResolutionDegrees: 1,
          dustRadiusDegrees: 5,
          seasonHalfWidthDegrees: 45,
          ls: grid.ls,
          radiationScaleHeightM: 10800,
          ...options,
        },
      };
    }

    function getSeasonEvents(ls) {
      if (!Number.isFinite(ls))
        throw new Error("Season must be a finite solar longitude.");
      return events
        .filter((event) => seasonDifference(event.ls, ls) <= 45)
        .map((event) => ({ ...event }));
    }

    function getScenario(options = {}) {
      return weatherGrid(options.weather, options.hazards);
    }
    function scenarioSample(lat, lon, options = {}) {
      const index = gridIndex(position({ lat, lon }));
      const scenario = getScenario(options);
      return {
        ...scenario.cells[index],
        index,
        hazards: scenario.hazardField
          ? root.MarsHazards.values(scenario.hazardField, index)
          : null,
      };
    }
    return {
      sample,
      plan,
      getSeasonEvents,
      dustAvailable,
      getScenario,
      scenarioSample,
    };
  }

  root.GlobalModel = { create, angularDistance, RADIUS };
})(typeof window === "undefined" ? globalThis : window);
