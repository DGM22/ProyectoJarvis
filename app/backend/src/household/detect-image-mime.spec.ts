import { detectImageMime } from './household.service';

describe('detectImageMime', () => {
  it('recognizes JPEG and PNG by their signature', () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(
      detectImageMime(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      ),
    ).toBe('image/png');
  });

  it('rejects anything else, whatever the Content-Type said', () => {
    expect(detectImageMime(Buffer.from('GIF89a'))).toBeNull();
    expect(detectImageMime(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageMime(Buffer.alloc(0))).toBeNull();
  });
});
