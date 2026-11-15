/* Display keys use the same colour functions as the map textures. */
(function (root) {
  "use strict";
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const unknown = [170, 130, 200, 210];
  const color = new THREE.Color();
  const hsl = (h, s, l, alpha) => {
    const c = color.setHSL(h, s, l);
    return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), Math.round(alpha)];
  };
  function planetColor(layer, value) {
    if (!Number.isFinite(value)) return unknown;
    let t;
    if (layer === "elevation") {
      t = clamp((value + 8000) / 29000);
      return hsl(0.65 - 0.65 * t, 0.65, 0.35 + t * 0.22, 225);
    }
    if (layer === "radiation") {
      if (value <= 0) return unknown;
      t = clamp((Math.log(value) + 0.75) / 2.8);
      return hsl(0.66 - 0.54 * t, 0.65, 0.38 + t * 0.16, 225);
    }
    t = clamp(value);
    return layer === "dust"
      ? hsl(0.12 - 0.12 * t, 0.9, 0.45 + t * 0.1, t ? 100 + 155 * Math.sqrt(t) : 0)
      : hsl(0.14 - 0.14 * t, 0.85, 0.42 + 0.1 * t, 35 + 210 * t);
  }
  function slopeColor(slope) {
    return slope === null || !Number.isFinite(slope) ? unknown
      : slope > 28 ? [224, 70, 54, 210]
      : slope > 15 ? [244, 167, 75, 175]
      : [105, 164, 117, Math.max(35, slope * 7)];
  }
  function conditionsColor(w) {
    return w ? [230, 112 + Math.round(80 * (1 - w.dust)), 45,
      Math.round(45 + 170 * Math.min(1, w.dust + w.wind / 70))] : [130, 80, 180, 160];
  }
  const css = (c) => `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
  const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function scale(colors, labels, low, high) {
    return `<div class="legend-scale"><div class="legend-direction"><span>${low}</span><span>${high} →</span></div><div class="legend-gradient" style="background:linear-gradient(to right,${colors.map(css).join(",")})" aria-hidden="true"></div><div class="legend-ticks">${labels.map((label) => `<span>${label}</span>`).join("")}</div></div>`;
  }
  const key = (color, text, cls = "") => `<span class="legend-key"><i class="${cls}"${color ? ` style="background:${css(color)}"` : ""}></i>${text}</span>`;
  const steps = [0, .25, .5, .75, 1];
  function hazard(layer, enabled = true) {
    const all = layer === "hazards", d = MarsHazards.definitions[layer];
    const title = all ? "Generated hazards" : d.name;
    const meanings = {
      sand: "Gold tint = loose sand / weak ground. Stronger tint means higher intensity; 80/100 or more closes the cell.",
      rocks: "Orange tint = sharp rocks / boulders. Stronger tint means higher intensity; 80/100 or more closes the cell.",
      rockfall: "Pink tint = unstable slopes / rockfall. Stronger tint means higher intensity; 80/100 or more closes the cell.",
      cold: "Stronger blue = a larger generated temperature drop (up to 75 °C). Cells below −100 °C are closed.",
      solar: "Stronger purple = a stronger solar particle event. At 70/100 or more, shelter and wait across the entire map.",
    };
    return {
      title, badge: enabled ? "SCENARIO · 0–100" : "DISABLED",
      meaning: !enabled ? "Generated hazards are switched off. Enable them in Hazard scenarios to see this layer."
        : all ? "Colour identifies the hazard type. Within each colour, stronger tint means higher intensity. White hatching marks a closed cell."
        : meanings[layer],
      visual: all ? `<div class="legend-keys">${Object.entries(MarsHazards.definitions).map(([, d]) => key([...d.color, 255], d.name)).join("")}</div>`
        : scale(steps.map((t) => MarsHazards.tint(layer, t)), ["0", "25", "50", "75", "100"], "Lower intensity", "Higher intensity"),
      note: `<div class="legend-keys">${key(null,"Closed / do not cross","legend-hatch")}${key([0,0,0,0],"Clear = no displayed generated hazard")}</div><p>These are simulated indices, not measured hazards or probabilities. Different colours are different hazards, not a single ranking.</p>`,
    };
  }
  const last = new WeakMap();
  function render(el, layer, spec, context = "") {
    const html = `<summary><strong>${spec.title}</strong><span class="legend-badge">${spec.badge}</span><span class="legend-toggle" aria-hidden="true"></span></summary><div class="legend-body"><p class="legend-meaning">${spec.meaning}</p>${spec.visual || ""}<div class="legend-note">${spec.note || ""}</div>${context ? `<p class="legend-context">${escape(context)}</p>` : ""}</div>`;
    const before = last.get(el);
    if (before?.html === html && before.layer === layer) return;
    const open = before?.layer === layer ? el.querySelector("details")?.open !== false : true;
    el.innerHTML = `<details class="layer-legend"${open ? " open" : ""}>${html}</details>`;
    el.dataset.layer = layer;
    last.set(el, {html, layer});
    if (el.id === "global-legend" && !el._legendResize) {
      el._legendResize = new ResizeObserver(() => document.documentElement.style.setProperty("--legend-height", `${el.offsetHeight}px`));
      el._legendResize.observe(el);
    }
  }
  function planet(el, layer, context, enabled) {
    const specs = {
      surface: {title:"HRSC / MOLA relief", badge:"TERRAIN", meaning:"Dark areas are shaded relief; lighter areas face the illumination. Brightness does not measure danger.", note:"200 m source spacing; the globe and long-distance route grid are coarser."},
      photo: {title:"Colour surface overview", badge:"IMAGERY", meaning:"Colours show the surface appearance. They do not indicate temperature, radiation or route safety.", note:"Switch to HRSC relief for terrain detail."},
      elevation: {title:"Elevation", badge:"km ABOVE AREOID", meaning:"Blue is lower terrain; green, yellow and red are progressively higher. Height alone does not show whether a route is passable.", visual:scale(steps.map(t=>planetColor(layer, -8000+29000*t)),["−8", "−0.8", "+6.5", "+13.8", "+21"],"Lower terrain","Higher terrain"), note:`<div class="legend-keys">${key(unknown,"Purple = missing elevation data")}</div>`},
      radiation: {title:"Radiation · relative exposure", badge:"SHIELDING PROXY", meaning:"Dark blue is lower; cyan is higher than dark blue; green → yellow is higher still.", visual:scale(steps.map(t=>planetColor(layer,Math.exp(2.8*t-.75))),["≈0.5×","≈1×","≈2×","≈4×","≈8×"],"Lower exposure proxy","Higher exposure proxy"), note:`1× is the reference at 0 km elevation. A higher number means less atmospheric shielding in this model. This is not a measured radiation dose or ground radioactivity map.<div class="legend-keys">${key(unknown,"Purple = missing terrain data")}</div>`},
      scenario: {title:"Weather · simulated dust", badge:"SCENARIO · 0–100", meaning:"Faint yellow means less dust. Orange → red means more dust. Wind and temperature are separate values, not separate colours.", visual:scale(steps.map(t=>planetColor(layer,t)),["0","25","50","75","100"],"Less dust","More dust"), note:"Hover over the globe for local wind, temperature and visibility. The field is a generated scenario."},
      dust: {title:"Historical dust detections", badge:"OBSERVATIONS · MY26–30", meaning:"Yellow → red means more nearby detections in the selected season. Pale dots mark observed storm centres.", visual:scale(steps.map(t=>planetColor(layer,t)),["0","25","50","75","100"],"Fewer recorded detections","More recorded detections"), note:"Scale: % of the seasonal maximum count within 5°. Clear areas have no recorded detections here; they are not proven clear or safe. Purple means the catalogue is unavailable. Coverage is uneven; this is not current weather."},
    };
    render(el,layer,specs[layer] || hazard(layer,enabled),context);
  }
  function local(el, layer, context, hazardLayer, enabled) {
    const routes = `<div class="legend-keys">${key([255,183,119,255],"Short route")}${key([178,228,193,255],"Adaptive route")}</div>`;
    const specs = {
      surface:{title:"HiRISE surface",badge:"ORBITAL IMAGERY",meaning:"Light and dark areas show the surface and shadows. They are not a hazard rating. Compare the two route lines on the same terrain.",visual:routes,note:"Proposed base and destinations; true vertical scale ×1 in 3D."},
      slope:{title:"Terrain slope",badge:"DEGREES",meaning:"Green is gentler. Amber is steep. Red exceeds the planner’s 28° limit and is blocked; purple has no terrain data.",visual:`<div class="legend-keys">${key(slopeColor(10),"0–15° · gentler")}${key(slopeColor(20),">15–28° · steep")}${key(slopeColor(30),">28° · blocked")}${key(slopeColor(null),"No data")}</div>`,note:"In the 2D view, red route segments mark slopes above 15°. Features smaller than the 5 m route grid remain unresolved."},
      science:{title:"Science destinations",badge:"PROPOSED SITES",meaning:"The pale BASE marker identifies the proposed base. The green science destination is selected. The lines compare the short and adaptive routes.",visual:routes,note:"These are proposed observation sites, not confirmed astronaut or rover survey locations."},
      conditions:{title:"Local weather exposure",badge:"SCENARIO",meaning:"Yellow → orange means more dust. Stronger tint means greater combined dust and wind exposure. Purple marks missing data.",visual:scale([0,.5,1].map(t=>conditionsColor({dust:t,wind:0})),["Less dust","Moderate","More dust"],"Lower exposure","Higher exposure"),note:"Use the weather controls to change temperature, wind and visibility. Colour alone does not determine whether a route is open."},
    };
    render(el, layer === "hazards" ? hazardLayer : layer, specs[layer] || hazard(hazardLayer,enabled), context);
  }
  root.MarsLayerLegend = {planetColor, slopeColor, conditionsColor, planet, local};
})(window);
