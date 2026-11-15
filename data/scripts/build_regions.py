"""Extract the inherited IAU catalogue using the source project's existing DBF reader.
Usage: python3 data/scripts/build_regions.py --source ../the_mars_map
The playable output is independent of the source folder.
"""
import argparse
import importlib.util
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
source = args.source.resolve()
spec = importlib.util.spec_from_file_location('inherited_assets', source / 'data/scripts/build_assets.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
regions = []
seen_ids = set()
for row in module.read_dbf(source / 'data/iau-nomenclature/MARS_nomenclature_center_pts.dbf'):
    if row['approval'] != 'Adopted by IAU':
        continue
    feature_id = row['link'].rsplit('/', 1)[-1]
    if feature_id in seen_ids:
        continue
    seen_ids.add(feature_id)
    regions.append({
        'id': row['link'].rsplit('/', 1)[-1], 'name': row['clean_name'] or row['name'],
        'type': row['type'], 'lat': float(row['center_lat']),
        'lon': (float(row['center_lon']) + 180) % 360 - 180,
        'diameter': float(row['diameter'] or 0), 'origin': row['origin'],
        'bounds': {key: float(row[key]) for key in ['min_lon', 'max_lon', 'min_lat', 'max_lat']},
        'source': row['link'].replace('http:', 'https:'), 'year': row['approvaldt'][:4]
    })
output = Path(__file__).resolve().parents[2] / 'js/regions.js'
output.write_text('// Extracted from the inherited IAU / USGS catalogue. Bounds are catalogue envelopes, not traced landform boundaries.\nwindow.MARS_REGIONS = ' + json.dumps(regions, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(f'{len(regions)} regions written to {output}')
