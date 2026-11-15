"""Drape local zones with the archived, map-projected HiRISE RED observation."""
import base64
import json
import re
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT.parent / "the_mars_map/data/hirise-gale"
label = (SOURCE / "ESP_019698_1750_RED_A_01_ORTHO.LBL").read_text()
def number(key):
    return float(re.search(r"^\s*" + key + r"\s*=\s*([-\d.]+)", label, re.M)[1])

# Decode at ~1 m/pixel; imagery and elevations then have comparable detail.
Image.MAX_IMAGE_PIXELS = None
image = Image.open(SOURCE / "ESP_019698_1750_RED_A_01_ORTHO.JP2")
image.reduce = 2
image.load()
resolution = number("MAP_RESOLUTION")
scale = number("MAP_SCALE")
for path in (ROOT / "assets/zones").glob("*.js"):
    data = json.loads(path.read_text().split("=", 1)[1].strip().rstrip(";"))
    row = -data["center"]["lat"] * resolution + number("LINE_PROJECTION_OFFSET") - 1
    col = (data["center"]["lon"] - number("CENTER_LONGITUDE")) * resolution + number("SAMPLE_PROJECTION_OFFSET") - 1
    for name in ("near", "far"):
        half = data[name]["size"] / scale / 2
        box = tuple(round(v / 4) for v in (col-half,row-half,col+half,row+half))
        crop = image.crop(box).convert("L")
        crop = ImageOps.autocontrast(crop, cutoff=1)
        target = ROOT / f"assets/zones/{data['id']}_{'ortho' if name=='near' else 'far'}.jpg"
        crop.save(target, quality=94)
        data[name]["ortho"] = "data:image/jpeg;base64," + base64.b64encode(target.read_bytes()).decode()
        if name == "near":
            rgb = ImageOps.colorize(crop, "#422e25", "#c6a488", mid="#92725a")
            rgb.resize((768,768)).save(ROOT / f"assets/zones/{data['id']}_thumb.jpg", quality=94)
    data["opticalSource"] = "ESP_019698_1750_RED_A_01_ORTHO; grayscale stretched and artistically tinted"
    path.write_text("window.ZONE_DATA = " + json.dumps(data,separators=(",",":")) + ";\n")
    print(data["id"], "optical texture saved", flush=True)
