"""Hand-tuned small icons (16, 24, 32), drawn on their own pixel grid."""
import sys

DEFS = '''<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="{S}" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#5440cc"/><stop offset="0.45" stop-color="#a65ad6"/><stop offset="0.78" stop-color="#ff8aae"/><stop offset="1" stop-color="#ffc08a"/></linearGradient>
<linearGradient id="pot" x1="{px0}" y1="0" x2="{px1}" y2="0" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#ffa36f"/><stop offset="0.5" stop-color="#f07446"/><stop offset="1" stop-color="#c64e2f"/></linearGradient>
<linearGradient id="rim" x1="{px0}" y1="0" x2="{px1}" y2="0" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#ffb486"/><stop offset="0.55" stop-color="#fa8650"/><stop offset="1" stop-color="#d65c38"/></linearGradient>
<clipPath id="t"><rect width="{S}" height="{S}" rx="{rx}"/></clipPath>
</defs>'''

def leaf(base, tip, u1, u2, l1, l2, vein, lo='#4cc865', hi='#c4f8a8'):
    (bx, by), (tx, ty) = base, tip
    full = f'M{bx} {by} C{u1[0]} {u1[1]} {u2[0]} {u2[1]} {tx} {ty} C{l1[0]} {l1[1]} {l2[0]} {l2[1]} {bx} {by} Z'
    top = f'M{bx} {by} C{u1[0]} {u1[1]} {u2[0]} {u2[1]} {tx} {ty} Q{vein[0]} {vein[1]} {bx} {by} Z'
    return f'<path d="{full}" fill="{lo}"/><path d="{top}" fill="{hi}"/>'

def svg(S, body, rx, px0, px1):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}">' + DEFS.format(S=S, rx=rx, px0=px0, px1=px1) + f'<g clip-path="url(#t)"><rect width="{S}" height="{S}" fill="url(#sky)"/>{body}</g></svg>'

def s32(rainbow=3):
    b = []
    b.append('<circle cx="6" cy="5" r=".7" fill="#fff" opacity=".8"/><circle cx="26.5" cy="4" r=".6" fill="#fff" opacity=".7"/>')
    bands = {3: [(13, '#ff6b6b'), (11, '#ffd93d'), (9, '#45a8f5')], 4: [(13.2, '#ff6b6b'), (11.7, '#ffd93d'), (10.2, '#6bdb6f'), (8.7, '#45a8f5')]}[rainbow]
    w = 2 if rainbow == 3 else 1.5
    for r, c in bands:
        b.append(f'<circle cx="16" cy="27" r="{r}" fill="none" stroke="{c}" stroke-width="{w}"/>')
    b.append('<path d="M0 25.5 C8 23 24 23 32 25.5 L32 32 L0 32 Z" fill="#56c46c"/>')
    b.append('<path d="M0 25.5 C8 23 24 23 32 25.5" fill="none" stroke="#a6ee92" stroke-width=".8"/>')
    b.append('<ellipse cx="16" cy="29.6" rx="7.5" ry="1.2" fill="#1d6a3e" opacity=".4"/>')
    # sprout
    b.append('<path d="M16 18 L16 10.6" stroke="#2fae5c" stroke-width="1.9" stroke-linecap="round"/>')
    b.append(leaf((16, 13.2), (6.6, 9.0), (14, 10), (11, 8.6), (7.8, 12.4), (12, 14.2), (11.5, 10.8)))
    b.append(leaf((16, 11.8), (25.6, 6.6), (18.2, 8.2), (21.5, 6.3), (24.6, 10.4), (20, 12.6), (20.8, 8.8)))
    b.append('<path d="M16 11.2 C15.2 9.2 15.6 7.4 17.1 5.9 C17.9 8 17.5 9.9 16 11.2 Z" fill="#b6f6a0"/>')
    # pot
    b.append('<path d="M9.6 20.4 L22.4 20.4 L21.1 28.4 Q20.9 29.4 19.9 29.4 L12.1 29.4 Q11.1 29.4 10.9 28.4 Z" fill="url(#pot)"/>')
    b.append('<rect x="9.7" y="20.4" width="12.6" height="1" fill="#8f3720" opacity=".4"/>')
    b.append('<rect x="8.4" y="17" width="15.2" height="3.6" rx="1.3" fill="url(#rim)"/>')
    b.append('<ellipse cx="16" cy="17.3" rx="6" ry=".8" fill="#5a2a1d"/>')
    # face
    b.append('<ellipse cx="11.9" cy="26" rx="1.2" ry=".75" fill="#ff5f93" opacity=".55"/><ellipse cx="20.1" cy="26" rx="1.2" ry=".75" fill="#ff5f93" opacity=".55"/>')
    b.append('<ellipse cx="13.6" cy="23.8" rx="1.1" ry="1.45" fill="#3a1d2c"/><ellipse cx="18.4" cy="23.8" rx="1.1" ry="1.45" fill="#3a1d2c"/>')
    b.append('<circle cx="14" cy="23.3" r=".45" fill="#fff"/><circle cx="18.8" cy="23.3" r=".45" fill="#fff"/>')
    b.append('<path d="M14.6 25.9 Q16 28 17.4 25.9 Z" fill="#3a1d2c"/>')
    # gold sparkle
    b.append('<path d="M5.5 14 Q5.7 15.8 7.5 16 Q5.7 16.2 5.5 18 Q5.3 16.2 3.5 16 Q5.3 15.8 5.5 14 Z" fill="#ffe27a"/>')
    return svg(32, ''.join(b), 7, 9, 23)

def s24(rainbow=True):
    b = []
    if rainbow:
        for r, c in [(9.8, '#ff6b6b'), (8.3, '#ffd93d'), (6.8, '#45a8f5')]:
            b.append(f'<circle cx="12" cy="20.5" r="{r}" fill="none" stroke="{c}" stroke-width="1.5"/>')
    b.append('<path d="M0 19.4 C6 17.4 18 17.4 24 19.4 L24 24 L0 24 Z" fill="#56c46c"/>')
    b.append('<ellipse cx="12" cy="22.4" rx="5.6" ry=".9" fill="#1d6a3e" opacity=".4"/>')
    b.append('<path d="M12 13.4 L12 8.2" stroke="#2fae5c" stroke-width="1.5" stroke-linecap="round"/>')
    b.append(leaf((12, 10.2), (4.8, 6.9), (10.5, 7.8), (8.2, 6.6), (5.8, 9.6), (9, 10.9), (8.7, 8.4)))
    b.append(leaf((12, 9.1), (19.4, 5.0), (13.7, 6.4), (16.3, 4.8), (18.6, 8.0), (15.2, 9.7), (15.6, 6.9)))
    b.append('<path d="M7.1 15.3 L16.9 15.3 L15.9 21.3 Q15.7 22.1 14.9 22.1 L9.1 22.1 Q8.3 22.1 8.1 21.3 Z" fill="url(#pot)"/>')
    b.append('<rect x="6.1" y="12.7" width="11.8" height="2.8" rx="1" fill="url(#rim)"/>')
    b.append('<ellipse cx="12" cy="12.95" rx="4.6" ry=".6" fill="#5a2a1d"/>')
    b.append('<ellipse cx="10.1" cy="17.9" rx=".85" ry="1.15" fill="#3a1d2c"/><ellipse cx="13.9" cy="17.9" rx=".85" ry="1.15" fill="#3a1d2c"/>')
    b.append('<path d="M11 19.6 Q12 21.2 13 19.6 Z" fill="#3a1d2c"/>')
    b.append('<path d="M4.2 11 Q4.35 12.4 5.7 12.5 Q4.35 12.6 4.2 14 Q4.05 12.6 2.7 12.5 Q4.05 12.4 4.2 11 Z" fill="#ffe27a"/>')
    return svg(24, ''.join(b), 5.2, 6, 18)

def s16(rainbow=True, face=True):
    b = []
    if rainbow:
        for r, c in [(6.6, '#ff6b6b'), (5.6, '#ffd93d')]:
            b.append(f'<circle cx="8" cy="13.6" r="{r}" fill="none" stroke="{c}" stroke-width="1"/>')
    b.append('<path d="M0 13 C4 11.8 12 11.8 16 13 L16 16 L0 16 Z" fill="#56c46c"/>')
    b.append('<path d="M8 9 L8 5" stroke="#2fae5c" stroke-width="1.2" stroke-linecap="round"/>')
    b.append(leaf((8, 6.9), (2.4, 4.4), (7, 5.2), (5.2, 4.2), (3.2, 6.4), (5.6, 7.4), (5.4, 5.6)))
    b.append(leaf((8, 6.1), (13.7, 3.2), (9.2, 4.0), (11.2, 3.0), (13.0, 5.4), (10.6, 6.6), (10.8, 4.7)))
    b.append('<path d="M4.4 10 L11.6 10 L10.9 14.3 Q10.8 15 10.1 15 L5.9 15 Q5.2 15 5.1 14.3 Z" fill="url(#pot)"/>')
    b.append('<rect x="3.6" y="8" width="8.8" height="2.2" rx=".8" fill="url(#rim)"/>')
    if face:
        b.append('<rect x="6" y="11.2" width="1.1" height="1.5" rx=".4" fill="#3a1d2c"/><rect x="8.9" y="11.2" width="1.1" height="1.5" rx=".4" fill="#3a1d2c"/>')
        if face == 'd':
            b.append('<path d="M6.9 13 Q8 14.7 9.1 13 Z" fill="#3a1d2c"/>')
        else:
            b.append('<rect x="7.1" y="13.2" width="1.8" height=".9" rx=".4" fill="#3a1d2c"/>')
    return svg(16, ''.join(b), 3.6, 3.6, 12.4)

if __name__ == '__main__':
    # The versions in use: 32 with four bands of rainbow, 24 with three,
    # 16 (also used at 20) with no rainbow and a curved smile.
    open('s32.svg', 'w').write(s32(4))
    open('s24.svg', 'w').write(s24(True))
    open('s16.svg', 'w').write(s16(False, 'd'))
