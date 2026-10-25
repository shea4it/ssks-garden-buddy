"""Render every size and pack icon.ico / icon.icns (run from this folder:
`python3 small.py && python3 big.py && python3 make_icons.py out`).

Sizes come from different drawings, each tuned for its size:
  win.svg     full detail      256, 128, 1024 (icon.png)
  winmid.svg  fewer details    96, 64, 48, 40
  s32.svg    32 px grid       32
  s24.svg     24 px grid       24
  s16.svg    16 px grid       20, 16
  mac.svg / macmid.svg         Apple's grid (824 of 1024) with a soft shadow
"""
import io, os, struct, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
os.makedirs(OUT, exist_ok=True)
_cache = {}

def png(svg, size):
    key = (svg, size)
    if key not in _cache:
        tmp = os.path.join(OUT, f'_{os.path.splitext(svg)[0]}_{size}.png')
        render.single(tmp, svg, size)
        im = Image.open(tmp).convert('RGBA')
        im.load()
        os.remove(tmp)
        _cache[key] = im
    return _cache[key]

WIN = {256: 'win.svg', 128: 'win.svg', 96: 'winmid.svg', 64: 'winmid.svg', 48: 'winmid.svg', 40: 'winmid.svg',
       32: 's32.svg', 24: 's24.svg', 20: 's16.svg', 16: 's16.svg'}

def bmp_entry(im):
    """A 32-bit BMP icon image (BITMAPINFOHEADER, bottom-up BGRA, AND mask)."""
    w, h = im.size
    hdr = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    px = im.tobytes('raw', 'BGRA')
    rows = [px[y * w * 4:(y + 1) * w * 4] for y in range(h)]
    xor = b''.join(reversed(rows))
    mask_row = ((w + 31) // 32) * 4
    a = im.getchannel('A').tobytes()
    mrows = []
    for y in range(h - 1, -1, -1):
        bits = bytearray(mask_row)
        for x in range(w):
            if a[y * w + x] == 0:
                bits[x // 8] |= 0x80 >> (x % 8)
        mrows.append(bytes(bits))
    return hdr + xor + b''.join(mrows)

def write_ico(path, images):
    images = sorted(images, key=lambda im: -im.size[0])
    blobs = []
    for im in images:
        if im.size[0] >= 256:
            b = io.BytesIO(); im.save(b, 'PNG', optimize=True); blobs.append(b.getvalue())
        else:
            blobs.append(bmp_entry(im))
    out = struct.pack('<HHH', 0, 1, len(images))
    off = 6 + 16 * len(images)
    for im, data in zip(images, blobs):
        w, h = im.size
        out += struct.pack('<BBBBHHII', w % 256, h % 256, 0, 0, 1, 32, len(data), off)
        off += len(data)
    out += b''.join(blobs)
    open(path, 'wb').write(out)

def write_icns(path, entries):
    body = b''
    for kind, im in entries:
        b = io.BytesIO(); im.save(b, 'PNG', optimize=True); data = b.getvalue()
        body += kind.encode('ascii') + struct.pack('>I', len(data) + 8) + data
    open(path, 'wb').write(b'icns' + struct.pack('>I', len(body) + 8) + body)

if __name__ == '__main__':
    ico_imgs = [png(svg, z) for z, svg in WIN.items()]
    write_ico(os.path.join(OUT, 'icon.ico'), ico_imgs)
    png('win.svg', 1024).save(os.path.join(OUT, 'icon.png'), optimize=True)
    png('win.svg', 256).save(os.path.join(OUT, 'app-icon.png'), optimize=True)
    mac = [('icp4', png('s16.svg', 16)), ('icp5', png('s32.svg', 32)), ('icp6', png('macmid.svg', 64)),
           ('ic07', png('mac.svg', 128)), ('ic08', png('mac.svg', 256)), ('ic09', png('mac.svg', 512)),
           ('ic10', png('mac.svg', 1024)), ('ic11', png('s32.svg', 32)), ('ic12', png('macmid.svg', 64)),
           ('ic13', png('mac.svg', 256)), ('ic14', png('mac.svg', 512))]
    write_icns(os.path.join(OUT, 'icon.icns'), mac)
    for z, svg in WIN.items():
        png(svg, z).save(os.path.join(OUT, f'win-{z}.png'))
    print('done')
