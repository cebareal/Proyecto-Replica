"""Genera los iconos PNG de Hilo sin dependencias (solo zlib).

Uso:  python app/tools/make_icons.py
Dibuja un fondo verde y un trazo blanco en forma de check que termina en un hilo.
"""
import math, os, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")
BG = (0x2F, 0x7D, 0x6D)
FG = (0xFF, 0xFF, 0xFF)
# Puntos del trazo en coordenadas 0..1 (dentro de la zona segura de iconos "maskable").
PATH = [(0.30, 0.52), (0.44, 0.66), (0.70, 0.36)]
WIDTH = 0.085


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def render(size):
    rows = []
    half = WIDTH / 2
    aa = 1.0 / size
    for y in range(size):
        row = bytearray([0])
        py = (y + 0.5) / size
        for x in range(size):
            px = (x + 0.5) / size
            d = min(seg_dist(px, py, *PATH[i], *PATH[i + 1]) for i in range(len(PATH) - 1))
            a = max(0.0, min(1.0, (half - d) / aa + 0.5))
            row += bytes(round(BG[c] + (FG[c] - BG[c]) * a) for c in range(3))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def svg():
    pts = " ".join(f"{x * 100:.0f},{y * 100:.0f}" for x, y in PATH)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            f'<rect width="100" height="100" rx="22" fill="#2f7d6d"/>'
            f'<polyline points="{pts}" fill="none" stroke="#fff" stroke-width="{WIDTH * 100:.1f}" '
            f'stroke-linecap="round" stroke-linejoin="round"/></svg>\n')


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for s in (180, 192, 512):
        with open(os.path.join(OUT, f"icon-{s}.png"), "wb") as fh:
            fh.write(render(s))
    with open(os.path.join(OUT, "icon.svg"), "w", encoding="utf-8") as fh:
        fh.write(svg())
    print("iconos escritos en", os.path.normpath(OUT))
