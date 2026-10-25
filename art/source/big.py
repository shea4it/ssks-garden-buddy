"""Variants of master.svg: detail full/mid, tile size, mac shadow."""
import re, sys
SRC = open('master.svg').read()

def variant(tile=896, detail='full', mac=False):
    s = SRC
    if detail == 'mid':
        s = re.sub(r'<!--d-->.*?<!--/d-->', '', s, flags=re.S)
        # chunkier strokes for small sizes
        s = s.replace('stroke="url(#stem)" stroke-width="30"', 'stroke="url(#stem)" stroke-width="40"')
        s = s.replace('stroke="#3a1d2c" stroke-width="8"', 'stroke="#3a1d2c" stroke-width="10"')
    head, rest = s.split('>', 1)
    defs_end = rest.index('</defs>') + len('</defs>')
    defs, body = rest[:defs_end], rest[defs_end:]
    body = body.replace('</svg>', '')
    k = tile / 896
    extra_defs = ''
    shadow = ''
    if mac:
        extra_defs = '<defs><filter id="macShadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter></defs>'
        shadow = '<rect x="64" y="84" width="896" height="896" rx="200" fill="#000" opacity=".32" filter="url(#macShadow)"/>'
    return f'{head}>{defs}{extra_defs}<g transform="translate(512 512) scale({k:.5f}) translate(-512 -512)">{shadow}{body}</g></svg>'

if __name__ == '__main__':
    open('win.svg', 'w').write(variant(968))
    open('winmid.svg', 'w').write(variant(1000, 'mid'))
    open('mac.svg', 'w').write(variant(824, mac=True))
    open('macmid.svg', 'w').write(variant(824, 'mid', mac=True))
