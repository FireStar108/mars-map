#!/usr/bin/env python3
"""Build compact, local mission terrain assets from the HiRISE Gale DTM."""

from __future__ import annotations

import argparse
import base64
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
DTM_PATH = ROOT / "data/hirise-gale/DTEEC_019698_1750_019988_1750_U01.IMG"
ZONES_PATH = ROOT / "js/zones.js"
OUT_DIR = ROOT / "assets/zones"
NEAR_CELLS = 400
FAR_STEP_M = 8.0
FAR_SIZE_M = 600.0
LAYER_CELLS = 100
THUMB_SIZE = 512


def label_number(label: str, name: str) -> float:
    match = re.search(
        rf"^\s*{re.escape(name)}\s*=\s*([-+]?\d+(?:\.\d*)?(?:[Ee][-+]?\d+)?)",
        label,
        re.MULTILINE,
    )
    if not match:
        raise ValueError(f"Missing {name} in the HiRISE DTM label")
    return float(match.group(1))


def read_zones() -> list[dict[str, float | str]]:
    source = ZONES_PATH.read_text(encoding="utf-8")
    pattern = re.compile(
        r"id:\s*'([^']+)'.*?lat:\s*([-+]?\d+(?:\.\d+)?),\s*lon:\s*([-+]?\d+(?:\.\d+)?)",
        re.DOTALL,
    )
    zones = [
        {"id": zone_id, "lat": float(lat), "lon": float(lon)}
        for zone_id, lat, lon in pattern.findall(source)
    ]
    if not zones:
        raise ValueError(f"No zone coordinates found in {ZONES_PATH}")
    return zones


def project_pixels(
    x: np.ndarray,
    z: np.ndarray,
    center_row: float,
    center_col: float,
    map_scale: float,
) -> tuple[np.ndarray, np.ndarray]:
    return center_row + z / map_scale, center_col + x / map_scale


def sample_dem(
    dem: np.memmap,
    x: np.ndarray,
    z: np.ndarray,
    center_row: float,
    center_col: float,
    map_scale: float,
    *,
    allow_nodata: bool = False,
) -> np.ndarray:
    rows, cols = project_pixels(x, z, center_row, center_col, map_scale)
    r0 = np.floor(rows).astype(np.int32)
    c0 = np.floor(cols).astype(np.int32)
    if (
        r0.min() < 0
        or c0.min() < 0
        or r0.max() + 1 >= dem.shape[0]
        or c0.max() + 1 >= dem.shape[1]
    ):
        raise ValueError("A requested mission terrain tile falls outside the HiRISE DTM")

    dr = rows - r0
    dc = cols - c0
    h00 = dem[r0, c0]
    h10 = dem[r0, c0 + 1]
    h01 = dem[r0 + 1, c0]
    h11 = dem[r0 + 1, c0 + 1]
    values = (
        h00 * (1 - dc) * (1 - dr)
        + h10 * dc * (1 - dr)
        + h01 * (1 - dc) * dr
        + h11 * dc * dr
    )
    invalid = ~np.isfinite(values) | (values <= -10000)
    if np.any(invalid):
        if not allow_nodata:
            raise ValueError("A requested mission terrain tile contains invalid DTM samples")
        nearest_rows = np.rint(rows).astype(np.int32)
        nearest_cols = np.rint(cols).astype(np.int32)
        nearest = dem[nearest_rows, nearest_cols]
        nearest_invalid = ~np.isfinite(nearest) | (nearest <= -10000)
        values[invalid & ~nearest_invalid] = nearest[invalid & ~nearest_invalid]
        unresolved = invalid & nearest_invalid
        for radius in (1, 2, 4, 8, 16, 32, 64):
            if not np.any(unresolved):
                break
            for dr, dc in (
                (-radius, 0), (radius, 0), (0, -radius), (0, radius),
                (-radius, -radius), (-radius, radius),
                (radius, -radius), (radius, radius),
            ):
                rr = np.clip(nearest_rows + dr, 0, dem.shape[0] - 1)
                cc = np.clip(nearest_cols + dc, 0, dem.shape[1] - 1)
                candidate = dem[rr, cc]
                valid = unresolved & np.isfinite(candidate) & (candidate > -10000)
                values[valid] = candidate[valid]
                unresolved[valid] = False
        if np.any(unresolved):
            raise ValueError("Could not fill invalid samples around a mission DTM tile")
    return values.astype(np.float32)


def encode_elevations(heights: np.ndarray) -> dict[str, float | str | int]:
    h_min = float(heights.min())
    h_max = float(heights.max())
    h_scale = max((h_max - h_min) / 65535, 1e-6)
    encoded = np.rint((heights - h_min) / h_scale).astype("<u2")
    return {
        "n": int(heights.shape[0]),
        "hMin": h_min,
        "hScale": h_scale,
        "h": base64.b64encode(encoded.tobytes()).decode("ascii"),
    }


def make_relief_image(
    dem: np.memmap,
    center_row: float,
    center_col: float,
    map_scale: float,
    zone: dict[str, float | str],
    size_m: float,
    output_path: Path,
    *,
    color: bool,
    allow_nodata: bool = False,
) -> None:
    step = size_m / (THUMB_SIZE - 1)
    axis = np.linspace(-size_m / 2, size_m / 2, THUMB_SIZE, dtype=np.float32)
    x, z = np.meshgrid(axis, axis)
    heights = sample_dem(
        dem, x, z, center_row, center_col, map_scale, allow_nodata=allow_nodata
    )
    dz, dx = np.gradient(heights, step)
    normal_len = np.sqrt(dx * dx + dz * dz + 1)
    shade = np.clip((0.42 - 0.35 * dx + 0.55 * -dz) / normal_len, 0.2, 0.95)
    local = heights - np.nanmin(heights)
    local /= max(float(local.max()), 1e-6)
    luminance = np.clip(0.28 + 0.42 * local + 0.45 * shade, 0, 1)

    if color:
        rgb = np.stack(
            (luminance, luminance * 0.66, luminance * 0.46), axis=-1
        )
        image = Image.fromarray(np.uint8(rgb * 255), mode="RGB")
    else:
        image = Image.fromarray(np.uint8(luminance * 255), mode="L")
    image.save(output_path, quality=88, optimize=True)


def sky_view_layer(
    dem: np.memmap,
    x: np.ndarray,
    z: np.ndarray,
    center_row: float,
    center_col: float,
    map_scale: float,
) -> np.ndarray:
    center = sample_dem(dem, x, z, center_row, center_col, map_scale)
    view = np.zeros_like(center, dtype=np.float32)
    for angle in np.linspace(0, 2 * np.pi, 8, endpoint=False):
        horizon = np.zeros_like(center, dtype=np.float32)
        for distance in range(8, 129, 8):
            neighbor = sample_dem(
                dem,
                x + np.cos(angle) * distance,
                z + np.sin(angle) * distance,
                center_row,
                center_col,
                map_scale,
                allow_nodata=True,
            )
            horizon = np.maximum(
                horizon,
                np.arctan2(np.maximum(0, neighbor - center), distance),
            )
        view += np.cos(horizon) ** 2
    return np.rint(np.clip(view / 8, 0, 1) * 255).astype(np.uint8)


def build_zone(
    dem: np.memmap,
    zone: dict[str, float | str],
    projection: dict[str, float],
) -> None:
    map_scale = projection["map_scale"]
    center_row = -float(zone["lat"]) * projection["resolution"] + projection["line_offset"]
    center_col = (
        (float(zone["lon"]) - projection["center_lon"]) * projection["resolution"]
        + projection["sample_offset"]
    )

    near_size = NEAR_CELLS * map_scale
    near_axis = np.linspace(-near_size / 2, near_size / 2, NEAR_CELLS + 1, dtype=np.float32)
    nx, nz = np.meshgrid(near_axis, near_axis)
    near_heights = sample_dem(dem, nx, nz, center_row, center_col, map_scale)
    elevation_offset = float(sample_dem(
        dem,
        np.array([[0]], dtype=np.float32),
        np.array([[0]], dtype=np.float32),
        center_row,
        center_col,
        map_scale,
    )[0, 0])
    near_heights -= elevation_offset

    far_cells = round(FAR_SIZE_M / FAR_STEP_M)
    far_size = far_cells * FAR_STEP_M
    far_axis = np.linspace(-far_size / 2, far_size / 2, far_cells + 1, dtype=np.float32)
    fx, fz = np.meshgrid(far_axis, far_axis)
    far_heights = sample_dem(
        dem, fx, fz, center_row, center_col, map_scale, allow_nodata=True
    )
    far_heights -= elevation_offset

    layer_axis = np.linspace(-near_size / 2, near_size / 2, LAYER_CELLS + 1, dtype=np.float32)
    lx, lz = np.meshgrid(layer_axis, layer_axis)
    sky = sky_view_layer(dem, lx, lz, center_row, center_col, map_scale)

    zone_id = str(zone["id"])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    near_texture = f"assets/zones/{zone_id}_ortho.jpg"
    far_texture = f"assets/zones/{zone_id}_far.jpg"
    make_relief_image(
        dem, center_row, center_col, map_scale, zone, near_size,
        ROOT / near_texture, color=False,
    )
    make_relief_image(
        dem, center_row, center_col, map_scale, zone, far_size,
        ROOT / far_texture, color=False, allow_nodata=True,
    )
    make_relief_image(
        dem, center_row, center_col, map_scale, zone, near_size,
        OUT_DIR / f"{zone_id}_thumb.jpg", color=True,
    )

    def embed_jpeg(path: str) -> str:
        encoded = base64.b64encode((ROOT / path).read_bytes()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"

    layer_bytes = sky.tobytes()
    payload = {
        "id": zone_id,
        "center": {"lat": float(zone["lat"]), "lon": float(zone["lon"])},
        "elevationOffsetMeters": elevation_offset,
        "source": "HiRISE DTM DTEEC_019698_1750_019988_1750_U01",
        "near": {
            **encode_elevations(near_heights),
            "size": near_size,
            "ortho": embed_jpeg(near_texture),
        },
        "far": {
            **encode_elevations(far_heights),
            "size": far_size,
            "ortho": embed_jpeg(far_texture),
        },
        "layers": {
            "n": LAYER_CELLS + 1,
            "svf": base64.b64encode(layer_bytes).decode("ascii"),
            "sand": base64.b64encode(
                np.zeros_like(sky, dtype=np.uint8).tobytes()
            ).decode("ascii"),
        },
    }
    (OUT_DIR / f"{zone_id}.js").write_text(
        "window.ZONE_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(
        f"{zone_id}: {near_size:.1f} m HiRISE tile, "
        f"elevation offset {elevation_offset:.1f} m"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zone", help="Build one zone ID instead of all three")
    parser.add_argument("--dtm", type=Path, default=DTM_PATH, help="Path to the original HiRISE DTM IMG")
    args = parser.parse_args()
    dtm_path = args.dtm

    if not dtm_path.is_file():
        raise FileNotFoundError(f"HiRISE DTM not found: {dtm_path}")
    zones = read_zones()
    if args.zone:
        zones = [zone for zone in zones if zone["id"] == args.zone]
        if not zones:
            raise ValueError(f"Unknown zone ID: {args.zone}")

    header = dtm_path.open("rb").read(12000).decode("ascii", "replace")
    record_bytes = int(label_number(header, "RECORD_BYTES"))
    lines = int(label_number(header, "LINES"))
    samples = int(label_number(header, "LINE_SAMPLES"))
    projection = {
        "resolution": label_number(header, "MAP_RESOLUTION"),
        "map_scale": label_number(header, "MAP_SCALE"),
        "center_lon": label_number(header, "CENTER_LONGITUDE"),
        "line_offset": label_number(header, "LINE_PROJECTION_OFFSET"),
        "sample_offset": label_number(header, "SAMPLE_PROJECTION_OFFSET"),
    }
    expected_size = record_bytes * (lines + 1)
    if dtm_path.stat().st_size != expected_size:
        raise ValueError(
            f"Unexpected DTM size: got {dtm_path.stat().st_size}, "
            f"expected {expected_size} bytes"
        )
    dem = np.memmap(
        dtm_path,
        dtype="<f4",
        mode="r",
        offset=record_bytes,
        shape=(lines, samples),
    )

    for zone in zones:
        build_zone(dem, zone, projection)


if __name__ == "__main__":
    main()
