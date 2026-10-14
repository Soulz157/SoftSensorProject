import { buildPiCredentials } from './source-block';

const row = {
  host: 'https://pi.example',
  username: 'svc',
  dbName: 'PIDB',
  config: null,
};

describe('buildPiCredentials', () => {
  it('falls back to dbName when the source has no piServer override', () => {
    expect(buildPiCredentials(row, 's3cret')).toEqual({
      api_server: 'https://pi.example',
      pi_server: 'PIDB',
      user: 'svc',
      password: 's3cret',
    });
  });

  it('prefers config.piServer, the rule the connect + scheduler paths already used', () => {
    expect(
      buildPiCredentials({ ...row, config: { piServer: 'PIOTHER' } }, 'x')
        .pi_server,
    ).toBe('PIOTHER');
  });

  it.each([[{ piServer: '' }], [{ piServer: 42 }], [{}], [[]]])(
    'ignores a blank / non-string piServer (%j)',
    (config) => {
      expect(
        buildPiCredentials({ ...row, config: config }, 'x').pi_server,
      ).toBe('PIDB');
    },
  );
});
