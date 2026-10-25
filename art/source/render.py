"""render.py OUT.png SIZE SVG [SVG...] -> renders each SVG at SIZE (transparent) side by side.
Or: render.py --sheet OUT.png  svg1 svg2 ... (sizes 512,128,64,32,16 per row, on light and dark)"""
import sys, pathlib, base64
from playwright.sync_api import sync_playwright

def html_for(svgs, sizes, bg):
    rows = []
    for s in svgs:
        b64 = base64.b64encode(pathlib.Path(s).read_bytes()).decode()
        cells = ''.join(f'<div class="c"><img width="{z}" height="{z}" src="data:image/svg+xml;base64,{b64}"></div>' for z in sizes)
        rows.append(f'<div class="r">{cells}</div>')
    return f'<html><body style="margin:0;background:{bg}"><style>.r{{display:flex;align-items:flex-end;gap:24px;padding:16px}} .c img{{display:block}}</style>{"".join(rows)}</body></html>'

def shot(out, svgs, sizes, bg='transparent'):
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1400, 'height': 900}, device_scale_factor=1)
        pg.set_content(html_for(svgs, sizes, bg))
        pg.wait_for_timeout(200)
        el = pg.query_selector('body')
        pg.screenshot(path=out, full_page=True, omit_background=(bg == 'transparent'))
        b.close()

def single(out, svg, size):
    src = pathlib.Path(svg).read_text().replace('<svg ', f'<svg width="{size}" height="{size}" ', 1)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': size, 'height': size}, device_scale_factor=1)
        pg.set_content(f'<html><body style="margin:0;background:transparent"><style>svg{{display:block}}</style>{src}</body></html>')
        pg.wait_for_timeout(150)
        pg.screenshot(path=out, clip={'x': 0, 'y': 0, 'width': size, 'height': size}, omit_background=True)
        b.close()

if __name__ == '__main__':
    if sys.argv[1] == '--sheet':
        out = sys.argv[2]; svgs = sys.argv[3:]
        shot(out, svgs, [384, 128, 64, 48, 32, 24, 16], bg='#efe9f5')
    elif sys.argv[1] == '--dark':
        out = sys.argv[2]; svgs = sys.argv[3:]
        shot(out, svgs, [128, 64, 48, 32, 24, 16], bg='#1f1f24')
    else:
        single(sys.argv[1], sys.argv[3], int(sys.argv[2]))
