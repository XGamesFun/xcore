// Tiny real pictures for the preview-picture tests (tests/card*.test.mjs), made here rather than kept as binary files.
import { crc32, deflateSync } from 'node:zlib';

const chunk = (type, data) => {
  const len = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])));
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, crc]);
};

/** A real PNG of one colour, width × height (8-bit RGB). cut: that many bytes taken off its end. */
export function png(width, height, { color: [r, g, b] = [40, 90, 200], cut = 0 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const whole = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return cut ? whole.subarray(0, whole.length - cut) : whole;
}

const segment = (marker, body) => {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, body]);
};

/**
 * A JPEG's structure, width × height, as a camera or an editor writes it: SOI, JFIF, an optional EXIF block (`exif`
 * bytes) before the frame header, the quantisation and Huffman tables, the frame header (`frame`: 0xc0 baseline, 0xc2
 * progressive, 0xc3 lossless…), the scan, EOI. cut: that many bytes taken off its end.
 */
export function jpeg(width, height, { frame = 0xc0, exif = 0, cut = 0 } = {}) {
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  sof.set([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], 6);
  const whole = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    ...(exif ? [segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.alloc(exif, 0xff)]))] : []),
    segment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
    segment(frame, sof),
    segment(0xc4, Buffer.concat([Buffer.from([0]), Buffer.from([0, 1]), Buffer.alloc(14), Buffer.from([0])])),
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]),
    Buffer.from([0xff, 0xd9]),
  ]);
  return cut ? whole.subarray(0, whole.length - cut) : whole;
}
