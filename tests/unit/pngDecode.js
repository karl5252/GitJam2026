import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';

/**
 * Test-only reader for the 8-bit palette PNGs Aseprite exports (colour type 3, no
 * interlace), so unit tests can check art metadata against the real pixels.
 * @returns {{width: number, height: number, data: Uint8ClampedArray}} RGBA
 */
export function decodePalettePng(url) {
    const bytes = readFileSync(url);
    let width = 0;
    let height = 0;
    const palette = [];
    let alpha = [];
    const idat = [];
    for (let at = 8; at < bytes.length;) {
        const length = bytes.readUInt32BE(at);
        const type = bytes.toString('ascii', at + 4, at + 8);
        const body = bytes.subarray(at + 8, at + 8 + length);
        if (type === 'IHDR') {
            [width, height] = [body.readUInt32BE(0), body.readUInt32BE(4)];
            if (body[8] !== 8 || body[9] !== 3 || body[12] !== 0) throw new Error('only 8-bit, non-interlaced palette PNGs');
        } else if (type === 'PLTE') {
            for (let i = 0; i < body.length; i += 3) palette.push([body[i], body[i + 1], body[i + 2]]);
        } else if (type === 'tRNS') alpha = [...body];
        else if (type === 'IDAT') idat.push(body);
        at += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const data = new Uint8ClampedArray(width * height * 4);
    let previous = new Uint8Array(width);
    let current = new Uint8Array(width);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (width + 1)];
        for (let x = 0; x < width; x++) {
            const [a, b, c] = [x ? current[x - 1] : 0, previous[x], x ? previous[x - 1] : 0];
            let value = raw[y * (width + 1) + 1 + x];
            if (filter === 1) value += a;
            else if (filter === 2) value += b;
            else if (filter === 3) value += (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
                value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            current[x] = value & 255;
            const o = (y * width + x) * 4;
            const [r, g, bl] = palette[current[x]];
            data.set([r, g, bl, current[x] < alpha.length ? alpha[current[x]] : 255], o);
        }
        [previous, current] = [current, previous];
    }
    return {width, height, data};
}
