import { sniffImageMime } from './image-sniff';

describe('sniffImageMime', () => {
  it('detects JPEG from magic bytes', () => {
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg');
  });

  it('detects PNG from magic bytes', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(sniffImageMime(png)).toBe('image/png');
  });

  it('detects WebP (RIFF....WEBP)', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP', 'latin1'),
    ]);
    expect(sniffImageMime(webp)).toBe('image/webp');
  });

  it('rejects non-image and truncated content', () => {
    expect(sniffImageMime(Buffer.from('GIF89a'))).toBeNull(); // GIF unsupported by design
    expect(sniffImageMime(Buffer.from('<svg></svg>'))).toBeNull();
    expect(sniffImageMime(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(sniffImageMime(Buffer.from([0xff, 0xd8]))).toBeNull(); // too short
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
    // RIFF container that is not WebP (e.g. WAV)
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE', 'latin1'),
    ]);
    expect(sniffImageMime(wav)).toBeNull();
  });
});
