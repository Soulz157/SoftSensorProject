import { dockerLogText } from './docker-log-text';

/** One multiplexed Docker frame: stream id, 3 zero bytes, BE length, payload. */
function frame(stream: 1 | 2, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe('dockerLogText', () => {
  it('unwraps multiplexed frames, so no header byte reaches the text', () => {
    const buf = Buffer.concat([
      frame(1, 'loading artifact\n'),
      frame(2, 'RuntimeError: boom\n'),
    ]);
    const text = dockerLogText(buf);
    expect(text).toBe('loading artifact\nRuntimeError: boom\n');
    expect(text).not.toContain('\u0000');
  });

  it('the raw decode WOULD contain NUL — the bug this exists for', () => {
    const buf = frame(2, 'boom');
    expect(buf.toString('utf8')).toContain('\u0000');
    expect(dockerLogText(buf)).toBe('boom');
  });

  it('keeps a TTY container’s plain text as is, newlines and tabs included', () => {
    expect(dockerLogText(Buffer.from('a\tb\nc'))).toBe('a\tb\nc');
  });

  it('drops stray NUL and control bytes from plain text', () => {
    expect(dockerLogText(Buffer.from('ab\u0000c\u0007d\u001b[0me'))).toBe(
      'abcd[0me',
    );
  });

  it('keeps what a tail cut mid-frame still has', () => {
    const whole = frame(1, 'abcdef');
    const cut = whole.subarray(0, whole.length - 3);
    expect(dockerLogText(cut)).toBe('abc');
  });

  it('survives an empty buffer', () => {
    expect(dockerLogText(Buffer.alloc(0))).toBe('');
  });
});
