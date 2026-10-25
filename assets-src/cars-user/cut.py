import glob, os
from rembg import remove, new_session
from PIL import Image
s = new_session('isnet-general-use')
for f in sorted(glob.glob('*.*')):
    if f.endswith('.py'): continue
    im = Image.open(f).convert('RGBA')
    out = remove(im, session=s, post_process_mask=True)
    bb = out.getbbox(); out = out.crop(bb)
    out.save('cut/' + os.path.splitext(f)[0] + '.png')
    print(f, im.size, '->', out.size, flush=True)
