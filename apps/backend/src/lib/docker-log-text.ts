/**
 * Docker's `container.logs()` for a non-TTY container returns a MULTIPLEXED
 * stream: every frame is an 8-byte header (stream id, three zero bytes, a
 * big-endian payload length) followed by the payload. Decoding that buffer
 * as UTF-8 as-is leaves the header's 0x00 bytes in the text, and Postgres
 * refuses a text value containing one (`invalid byte sequence for encoding
 * "UTF8": 0x00`). That refusal landed INSIDE the container watcher's own
 * failure write, so a crashed container's run/window was never marked failed
 * and its real error was replaced by the database's.
 *
 * `dockerLogText` returns text that is safe to store: frames are unwrapped
 * when the buffer is multiplexed (a TTY container is plain text and is left
 * alone), and any control character Postgres or a reader cannot use is
 * dropped. Newlines and tabs stay.
 */
const HEADER_BYTES = 8;

function looksMultiplexed(buf: Buffer): boolean {
  return (
    buf.length >= HEADER_BYTES &&
    (buf[0] === 0 || buf[0] === 1 || buf[0] === 2) &&
    buf[1] === 0 &&
    buf[2] === 0 &&
    buf[3] === 0
  );
}

function unwrapFrames(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset + HEADER_BYTES <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    const start = offset + HEADER_BYTES;
    // A truncated last frame (the tail cut mid-write) keeps what it has.
    parts.push(buf.subarray(start, Math.min(start + size, buf.length)));
    offset = start + size;
  }
  return Buffer.concat(parts);
}

export function dockerLogText(buf: Buffer): string {
  const payload = looksMultiplexed(buf) ? unwrapFrames(buf) : buf;
  return (
    payload
      .toString('utf8')
      // eslint-disable-next-line no-control-regex -- the point is to remove them
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  );
}
