// Three Marswalk zones on lower Mount Sharp, Gale crater. All lie inside one HiRISE stereo DTM
// (DTEEC_019698_1750_019988_1750, 1 m/px) and its 25 cm orthoimage. lat/lon = zone centre.
// The terrain tiles themselves are built by data/scripts/build_zones.py into assets/zones/<id>.js.

window.ZONES = [
  {
    id: 'boxwork', n: '01', name: 'Boxwork Ridges',
    lat: -4.806, lon: 137.386, rover: 'Curiosity · sols 4450–5073 (2025)',
    objective: 'Sample the mineral ridges of the boxwork: fractures that groundwater filled with minerals, then wind carved out. They show how long water lasted under Mount Sharp.',
    hazards: 'Ridge-and-hollow terrain, 1–2 m drops between ridges, loose sand in hollows.',
    difficulty: 'Medium',
  },
  {
    id: 'gediz', n: '02', name: 'Gediz Vallis Channel',
    lat: -4.783, lon: 137.405, rover: 'Curiosity · sols 3900–4450 (2023–24)',
    objective: 'Reach the debris ridge of Gediz Vallis, where Curiosity cracked a rock open in 2024 and found pure elemental sulfur crystals for the first time on Mars.',
    hazards: 'Boulder fields from old floods and landslides, steep channel walls.',
    difficulty: 'Hard',
  },
  {
    id: 'uncharted', n: '03', name: 'Uncharted Sulfate Slopes',
    lat: -4.86, lon: 137.395, rover: 'No rover has been here',
    objective: 'Scout fresh ground ahead of Curiosity on the sulfate-bearing layers higher up Mount Sharp. Only orbital data exists, so the rover goes first.',
    hazards: 'Unknown surface, wind-carved yardangs, long climbs.',
    difficulty: 'Unknown',
  },
];
