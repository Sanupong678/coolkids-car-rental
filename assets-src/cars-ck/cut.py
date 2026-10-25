# Cuts the car out of the Coolkids price posters (1080x1080, logo top-right,
# name/price panel at the bottom) and writes the fleet images:
#   frontend/public/cars/<name>-{640,1200,2000}.webp  (transparent, never upscaled)
#   frontend/public/cars/line/<name>.jpg               (white background, for LINE)
# and mirrors the webp files into backend/src/db/assets/cars.
#   python cut.py
import os, shutil
from rembg import remove, new_session
from PIL import Image

SRC = r"C:\Users\Tumsa\Desktop\car imange"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PUB = os.path.join(ROOT, "frontend", "public", "cars")
BACK = os.path.join(ROOT, "backend", "src", "db", "assets", "cars")

POSTERS = {
    "ck-almera-grey": "eco car/Artboard 15.png",
    "ck-almera-white": "eco car/Artboard 16.png",
    "ck-city-black-outshine": "eco car/city E-HEV black outshine.png",
    "ck-yaris-ativ-premium": "eco car/yaris ativt premium.png",
    "ck-yaris-ativ-sport": "eco car/yaris ativt sport.png",
    "ck-accord-el": "premium car/accord e hev el.png",
    "ck-camry-premium": "premium car/camry hev premuim.png",
    "ck-civic-el": "premium car/civic e hev EL.png",
    "ck-civic-rs": "premium car/civic e hev rs.jpg",
    "ck-corolla-cross-gr": "SUV 5 seat/corolla cross gr sport.png",
    "ck-crv-es": "SUV 5 seat/CR-v e hev es.png",
    "ck-hrv-e": "SUV 5 seat/HRV e hev e.png",
    "ck-hrv-rs": "SUV 5 seat/HRV e hev rs.png",
    "ck-fortuner-leader": "SUV 7 Seat/FORTUNER LEADER.png",
    "ck-mux-active": "SUV 7 Seat/MU x active.png",
    "ck-pajero-sport": "SUV 7 Seat/PAJERO sport.png",
    "ck-veloz": "SUV 7 Seat/VELOZ.png",
}

session = new_session("isnet-general-use")
os.makedirs(os.path.join(PUB, "line"), exist_ok=True)
for name, rel in POSTERS.items():
    im = Image.open(os.path.join(SRC, rel)).convert("RGB")
    # drop the logo strip and the price panel, keep the white stage with the car
    stage = im.crop((0, 110, im.width, 830))
    out = remove(stage, session=session, post_process_mask=True)
    a = out.getchannel("A").point(lambda v: 0 if v < 24 else v)
    out.putalpha(a)
    out = out.crop(out.getbbox())
    for w in (640, 1200, 2000):
        ww = min(w, out.width)
        v = out.resize((ww, round(out.height * ww / out.width)), Image.LANCZOS) if ww != out.width else out
        f = f"{name}-{w}.webp"
        v.save(os.path.join(PUB, f), "WEBP", quality=90, method=6)
        shutil.copyfile(os.path.join(PUB, f), os.path.join(BACK, f))
    pad = round(out.width * 0.03)
    bg = Image.new("RGB", (out.width + 2 * pad, out.height + 2 * pad), "white")
    bg.paste(out, (pad, pad), out)
    bg.save(os.path.join(PUB, "line", f"{name}.jpg"), "JPEG", quality=90)
    print(name, out.size, flush=True)
