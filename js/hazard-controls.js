(function (root) {
  "use strict";
  function mount({ button, read, apply, locate, scope }) {
    const H = root.MarsHazards;
    const dialog = document.createElement("dialog");
    dialog.className = "hazard-dialog";
    dialog.id = "hazard-dialog";
    dialog.innerHTML = `<header><div><small>${scope === "global" ? "PLANET" : "CANDOR"} / GENERATED SCENARIO</small><h2>What stops the traverse?</h2></div><button id="hazard-close" aria-label="Close hazards">×</button></header><p class="hazard-intro">Explore hypothetical obstacles. The same generated field drives the map, route search and assessment.</p><label class="hazard-enabled"><input id="hazard-enabled" type="checkbox"> Include generated hazards in route planning</label><div class="hazard-seed"><label for="hazard-seed">Scenario seed</label><input id="hazard-seed" type="number" min="0" max="4294967295" step="1"><button id="hazard-generate">⤨ Generate</button><button id="hazard-clear">Clear hazards</button></div><div class="hazard-controls">${Object.entries(
      H.definitions,
    )
      .map(
        ([key, d]) =>
          `<label for="hazard-${key}"><span><i style="background:rgb(${d.color})"></i>${d.name}<output id="hazard-${key}-value"></output></span><input id="hazard-${key}" type="range" min="0" max="1" step=".05"><small>${d.effect}</small></label>`,
      )
      .join(
        "",
      )}</div><div class="hazard-focus"><label for="hazard-kind">Test a closure on this route</label><select id="hazard-kind">${H.keys.map((k) => `<option value="${k}">${H.definitions[k].name}</option>`).join("")}</select><button id="hazard-on-route">Place zone over route</button><button id="hazard-remove-focus">Remove test zone</button></div><p id="hazard-note" role="status"></p><p class="hazard-rule">Hatching = closed cell. Sand / rocks / unstable slopes close at 80/100. Cold uses the −100 °C scenario limit. A solar alert at 70/100 requires shelter across the map.</p><details><summary>Why these hazards? Sources & model</summary>${H.evidenceHtml()}</details><footer><button id="hazard-apply">Apply & show hazard map →</button></footer>`;
    document.body.append(dialog);
    const $ = (id) => dialog.querySelector("#" + id);
    let draft = H.normalize(read());
    function populate() {
      $("hazard-enabled").checked = draft.enabled;
      $("hazard-seed").value = draft.seed;
      for (const k of [...H.keys, "solar"]) {
        $("hazard-" + k).value = draft[k];
        $("hazard-" + k + "-value").textContent =
          Math.round(draft[k] * 100) + "/100";
      }
      const f = draft[scope + "Focus"];
      $("hazard-note").textContent = f
        ? `Test closure: ${H.definitions[f.kind].name}. Its placement is hypothetical.`
        : `Seed ${draft.seed} · spatial pattern stays fixed until the seed changes.`;
    }
    for (const k of [...H.keys, "solar"])
      $("hazard-" + k).oninput = () => {
        draft[k] = Number($("hazard-" + k).value);
        $("hazard-" + k + "-value").textContent =
          Math.round(draft[k] * 100) + "/100";
      };
    $("hazard-enabled").onchange = () =>
      (draft.enabled = $("hazard-enabled").checked);
    $("hazard-seed").onchange = () => {
      draft.seed = Number($("hazard-seed").value) >>> 0;
      populate();
    };
    $("hazard-generate").onclick = () => {
      draft = H.generate();
      populate();
    };
    $("hazard-clear").onclick = () => {
      draft = H.normalize({
        ...draft,
        sand: 0,
        rocks: 0,
        rockfall: 0,
        cold: 0,
        solar: 0,
        globalFocus: null,
        localFocus: null,
      });
      populate();
    };
    $("hazard-on-route").onclick = () => {
      const point = locate();
      if (!point) {
        $("hazard-note").textContent =
          "Choose a departure and destination first.";
        return;
      }
      draft.enabled = true;
      draft[scope + "Focus"] = {
        kind: $("hazard-kind").value,
        ...point,
        radius: scope === "global" ? 6 : 0.08,
        strength: 1,
      };
      populate();
    };
    $("hazard-remove-focus").onclick = () => {
      draft[scope + "Focus"] = null;
      populate();
    };
    $("hazard-apply").onclick = () => {
      if (!$("hazard-seed").reportValidity()) return;
      draft = H.normalize({ ...draft, seed: Number($("hazard-seed").value) });
      apply(H.save(draft));
      dialog.close();
    };
    document.getElementById(button).onclick = () => {
      draft = H.normalize(read());
      populate();
      dialog.showModal();
    };
    $("hazard-close").onclick = () => dialog.close();
    return { dialog };
  }
  root.MarsHazardUI = { mount };
})(window);
