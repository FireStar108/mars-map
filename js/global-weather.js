(function () {
  "use strict";
  const $ = (id) => document.getElementById(id),
    planner = window.__globalPlanner;
  const fields = [
    ["temperature", "Background temperature", -120, 0, 1, "°C"],
    ["wind", "Background wind", 0, 40, 1, "m/s"],
    ["direction", "Wind from · local handoff", 0, 355, 5, "°"],
    ["visibility", "Background visibility", 50, 3000, 50, "m"],
    ["severity", "Dust plume strength", 0, 1, 0.05, ""],
    ["lat", "Plume centre latitude", -85, 85, 1, "°"],
    ["lon", "Plume centre longitude", -180, 180, 1, "°"],
    ["radius", "Plume radius", 2, 60, 1, "°"],
  ];
  const dialog = document.createElement("dialog");
  dialog.id = "weather-dialog";
  dialog.innerHTML = `<div class="weather-dialog-head"><div><small>PLANET / SCENARIO LAB</small><h2>Change the conditions.</h2></div><button id="weather-close" aria-label="Close weather">×</button></div><p>A reproducible dust plume across Mars. Routes respond to its position and intensity. These controls define a scenario, not a forecast.</p><div class="weather-form">${fields.map(([id, name, min, max, step, unit]) => `<label for="gw-${id}">${name}<output id="gw-${id}-value"></output><input id="gw-${id}" type="range" min="${min}" max="${max}" step="${step}"></label>`).join("")}</div><div class="weather-actions"><button id="gw-clear">Clear</button><button id="gw-random">⤨ Generate scenario</button><button id="gw-route-storm">Place plume over route</button></div><p id="gw-note"></p><button id="gw-apply">Apply & view on planet →</button>`;
  document.body.append(dialog);
  let draft = { ...planner.state.weather };
  function populate() {
    for (const [id, , , , , unit] of fields) {
      $("gw-" + id).value = draft[id];
      $("gw-" + id + "-value").textContent =
        Number(draft[id].toFixed(2)) + " " + unit;
    }
    $("gw-note").textContent =
      `Seed ${draft.seed} · values remain fixed until you change or regenerate them.`;
  }
  for (const [id, , , , , unit] of fields)
    $("gw-" + id).oninput = () => {
      draft[id] = Number($("gw-" + id).value);
      $("gw-" + id + "-value").textContent = draft[id] + " " + unit;
    };
  $("weather-open").onclick = () => {
    draft = { ...planner.state.weather };
    populate();
    dialog.showModal();
  };
  $("weather-close").onclick = () => dialog.close();
  $("gw-random").onclick = () => {
    draft = MarsWeather.generate();
    populate();
  };
  $("gw-clear").onclick = () => {
    draft = MarsWeather.normalize({
      ...draft,
      temperature: -35,
      wind: 4,
      visibility: 3000,
      severity: 0,
    });
    populate();
  };
  $("gw-route-storm").onclick = () => {
    const route = planner.state.result?.routes.find((r) => r.id === "short");
    const middle =
      route?.points[Math.floor(route.points.length / 2)] || planner.state.to;
    draft = {
      ...draft,
      lat: middle.lat,
      lon: middle.lon,
      severity: 1,
      radius: 12,
    };
    populate();
  };
  $("gw-apply").onclick = () => {
    draft = MarsWeather.normalize(draft);
    $("planet-layer").value = "scenario";
    window.dispatchEvent(new CustomEvent("mars-weather", { detail: draft }));
    dialog.close();
  };
})();
