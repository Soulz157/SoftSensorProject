import { redactUrls } from './redact-urls';

describe('redactUrls (MODEL-SERVE-001-T09)', () => {
  it('redacts a presigned object URL, credential and all', () => {
    const reason =
      'Materialize failed: 404 Client Error: Not Found for url: ' +
      'https://minio.local:9000/gold/drafts/abc/model.joblib?' +
      'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA...' +
      '&X-Amz-Signature=deadbeef';

    expect(redactUrls(reason)).toBe(
      'Materialize failed: 404 Client Error: Not Found for url: [redacted url]',
    );
  });

  it('leaves ordinary codebase-authored prose untouched', () => {
    const reason = 'Only 12 usable row(s), below INFERENCE_MIN_ROWS (30).';
    expect(redactUrls(reason)).toBe(reason);
  });

  it('redacts a bare http URL too, not only https', () => {
    expect(redactUrls('reached http://pi-host:5450/api')).toBe(
      'reached [redacted url]',
    );
  });

  it('redacts every URL when a reason names more than one', () => {
    const reason = 'tried https://a.example/x then https://b.example/y';
    expect(redactUrls(reason)).toBe('tried [redacted url] then [redacted url]');
  });
});
