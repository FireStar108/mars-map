#!/usr/bin/env python3
"""Bundle the small OMEGA dust-storm catalogue for direct browser use."""

import argparse
import csv
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen


SOURCE_URL = (
    "https://zenodo.org/records/18618930/files/"
    "OMEGA_dust_storm_catalogue_Leseigneur_et_al_v2.csv?download=1"
)
EXPECTED_MD5 = "6f635d7fe99e9cefd3a1d2be4de721c9"
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def build_catalogue(raw):
    if hashlib.md5(raw).hexdigest() != EXPECTED_MD5:
        raise ValueError("The source checksum differs from the pinned Zenodo v2 release.")
    lines = (line for line in raw.decode("utf-8-sig").splitlines() if not line.startswith("#"))
    rows = list(csv.DictReader(lines))
    if len(rows) != 448:
        raise ValueError(f"Expected 448 detections, received {len(rows)}.")
    events = []
    for index, row in enumerate(rows):
        event = {
            "detectionId": f"odsc-{index + 1:03d}",
            "id": row["Obs_ID"],
            "my": int(row["MY"]),
            "ls": float(row["Ls"]),
            "localTime": float(row["LT"]),
            "lon": float(row["Longitude_centroid"]),
            "lat": float(row["Latitude_centroid"]),
            "areaKm2": float(row["Surface_area"]),
            "tau": float(row["taudust_median"]),
            "dustLifting": row["Dust_lifting"] == "Yes",
            "bounds": {
                "west": float(row["Longitude_min"]),
                "east": float(row["Longitude_max"]),
                "south": float(row["Latitude_min"]),
                "north": float(row["Latitude_max"]),
            },
            "catalogueSource": row["Catalogue_source"],
            "otherSourceId": row["ID_other_source"] or None,
        }
        if not (0 <= event["lon"] <= 360 and -90 <= event["lat"] <= 90):
            raise ValueError(f"Invalid coordinate in {event['id']}")
        if not (0 <= event["ls"] < 360 and event["areaKm2"] > 0):
            raise ValueError(f"Invalid season or area in {event['id']}")
        events.append(event)

    return {
        "metadata": {
            "title": "OMEGA/Mars Express Dust Storm Catalogue (ODSC)",
            "version": "Zenodo v2, 2026-02-11",
            "credit": "Yann Leseigneur and contributors; OMEGA/Mars Express; MDAD and MADO co-detections",
            "doi": "10.5281/zenodo.18618930",
            "url": "https://zenodo.org/records/18618930",
            "csvUrl": SOURCE_URL,
            "sourceMd5": EXPECTED_MD5,
            "license": "CC BY 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "accessed": "2026-11-15",
            "yearRange": [26, 30],
            "earthYearRange": [2004, 2010],
            "detectionCount": len(events),
            "coordinateConvention": "Planetographic details are not specified by the catalogue; longitude 0–360 east, latitude -90–90 north, degrees.",
            "tauWavelengthMicrons": 0.9,
            "areaDescription": "Reported observed storm area in square kilometres, generally a minimum extent.",
            "boundsDescription": "Catalogue bounding coordinates, not storm outlines. west > east indicates a longitude wrap through 0 degrees.",
            "limitations": [
                "Detections are historical observations with uneven orbital coverage and local-time sampling.",
                "Detection counts do not establish event probability, storm frequency, or present weather.",
                "Multiple observations can refer to the same storm; cross-catalogue identifiers are retained.",
                "Centroids and bounding boxes provide regional context; they do not establish local surface visibility or wind.",
                "The Zenodo release is v2; the downloaded CSV retains an internal v1 comment dated 2025-09-30.",
            ],
        },
        "events": events,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Use an already downloaded catalogue CSV.")
    parser.add_argument("--output", type=Path, default=PROJECT_ROOT / "assets/global/storms.js")
    args = parser.parse_args()
    if args.input:
        raw = args.input.read_bytes()
    else:
        with urlopen(SOURCE_URL, timeout=45) as response:
            raw = response.read()
    catalogue = build_catalogue(raw)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "// ODSC v2, Leseigneur et al.; CC BY 4.0. See metadata for provenance and limits.\n"
        + "window.MARS_STORMS = "
        + json.dumps(catalogue, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(catalogue['events'])} detections to {args.output}")


if __name__ == "__main__":
    main()
