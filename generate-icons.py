import struct, zlib, math, os

def make_icon(size):
    cx = cy = size // 2
    bg = (11, 15, 26); blue = (59, 130, 246); blue2 = (29, 78, 216); white = (255, 255, 255)
    raw_rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            dx = x - cx; dy = y - cy
            dist = math.sqrt(dx*dx + dy*dy)
            half = size * 0.5; r_norm = dist / half; rx = dx / half; ry = dy / half
            pr, pg, pb = bg
            if r_norm < 0.70:
                a = 0.20
                pr = int(bg[0]*(1-a)+blue[0]*a); pg = int(bg[1]*(1-a)+blue[1]*a); pb = int(bg[2]*(1-a)+blue[2]*a)
            bx = rx / 0.43; by = ry / 0.43
            if bx*bx + by*by < 1.0:
                t = max(0.0, min(1.0, (rx + ry + 1.0) / 2.0))
                pr = int(blue[0]+t*(blue2[0]-blue[0])); pg = int(blue[1]+t*(blue2[1]-blue[1])); pb = int(blue[2]+t*(blue2[2]-blue[2]))
            if (abs(ry) < 0.055 and abs(rx) < 0.43) or (abs(rx) < 0.055 and abs(ry) < 0.43):
                pr, pg, pb = white
            if 0.10 < r_norm < 0.18:
                pr, pg, pb = white
            row += bytes([pr, pg, pb, 255])
        raw_rows.append(bytes(row))
    raw = b''.join(raw_rows)
    compressed = zlib.compress(raw, 9)
    def chunk(tag, data):
        t = tag.encode('ascii'); crc = zlib.crc32(t + data) & 0xffffffff
        return struct.pack('>I', len(data)) + t + data + struct.pack('>I', crc)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk('IHDR', ihdr) + chunk('IDAT', compressed) + chunk('IEND', b'')

os.makedirs('public', exist_ok=True)
for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png')]:
    data = make_icon(size)
    for dest in [name, f'public/{name}']:
        with open(dest, 'wb') as f:
            f.write(data)
    print(f'Generated {name}: {len(data)} bytes')
