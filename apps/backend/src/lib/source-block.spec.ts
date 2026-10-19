import { buildPiCredentials, buildSourceBlock } from './source-block';

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

jest.mock('@/lib/crypto', () => ({ decryptSecret: () => 's3cret' }));

describe('buildSourceBlock — PI summary parameters', () => {
  const source = {
    type: 'aveva',
    host: 'https://pi.example',
    username: 'svc',
    dbName: 'PIDB',
    secretCiphertext: 'enc',
    config: null,
  };
  const base = {
    tags: ['FI-1'],
    startTime: '2026-01-01 00:00:00',
    endTime: '2026-01-02 00:00:00',
  };

  it('forwards the Historical Fetch Settings so the BRONZE matches the screen', () => {
    const block = buildSourceBlock(source, {
      ...base,
      summaryDuration: '1h',
      calBasis: 'EventWeighted',
      summaryType: ['Maximum'],
      batchSize: 50,
    });
    expect(block).toEqual({
      pi: expect.objectContaining({
        summary_duration: '1h',
        cal_basis: 'EventWeighted',
        summary_type: ['Maximum'],
        batch_size: 50,
      }),
    });
  });

  it('sends none of them when the caller gives none (python defaults apply)', () => {
    const block = buildSourceBlock(source, base) as { pi: object };
    expect(Object.keys(block.pi).sort()).toEqual([
      'credentials',
      'end_time',
      'start_time',
      'tag_list',
    ]);
  });
});
