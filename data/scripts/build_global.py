"""Create a compact global MOLA grid from the inherited PDS MEGDR raster.
Usage: python3 data/scripts/build_global.py --source ../the_mars_map/data/mola/megt90n000eb.img
"""
import argparse, json
from pathlib import Path
import numpy as np
parser=argparse.ArgumentParser()
parser.add_argument('--source',type=Path,required=True)
args=parser.parse_args()
raw=np.fromfile(args.source,dtype='>i2').reshape(2880,5760)
raw=np.roll(raw,2880,axis=1)
heights=np.rint(raw.reshape(360,8,720,8).mean(axis=(1,3))).astype(int)
data={'width':720,'height':360,'stepDegrees':.5,'nativeStepDegrees':.0625,'radiusKm':3396.19,'source':'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/','product':'MEGT90N000EB.IMG','heights':heights.ravel().tolist()}
out=Path(__file__).resolve().parents[2]/'assets/global/mola.js'
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text('window.MARS_GLOBAL = '+json.dumps(data,separators=(',',':'))+';\n')
print(out,heights.min(),heights.max())
