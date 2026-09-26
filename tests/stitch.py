"""Lay the tour's screenshots out for looking at: three screenfuls side by
side per image, the header (title + tabs) kept only on the first of each tab.

    python3 tests/stitch.py <tour folder>

Writes view-<tab>-<n>.png next to the pieces. (Stitching them into one tall
image by matching rows doesn't work reliably: the scrollbar and any toast
change between screenfuls. Side by side is simple and hides nothing.)
"""
import json
import os
import sys

from PIL import Image

HEADER = 104  # the panel's title and tab bar


def main(folder):
    idx = json.load(open(os.path.join(folder, 'index.json')))['index']
    tabs = []
    for e in idx:
        if e['tab'] not in tabs:
            tabs.append(e['tab'])
    for tab in tabs:
        ims = [Image.open(e['file']).convert('RGB') for e in idx if e['tab'] == tab]
        ims = [ims[0]] + [im.crop((0, HEADER, im.size[0], im.size[1])) for im in ims[1:]]
        for k in range(0, len(ims), 3):
            grp = ims[k:k + 3]
            h = max(i.size[1] for i in grp)
            w = sum(i.size[0] for i in grp) + 10 * (len(grp) - 1)
            out = Image.new('RGB', (w, h), (15, 10, 20))
            x = 0
            for i in grp:
                out.paste(i, (x, 0))
                x += i.size[0] + 10
            name = os.path.join(folder, f'view-{tab}-{k // 3}.png')
            out.save(name)
            print(name, out.size)


if __name__ == '__main__':
    main(sys.argv[1])
