import {
  resolveColumnBaseline,
  resetColumnBaselineCacheForTests,
} from './artifact-baseline';
import { postToPython } from '@/lib/python-client';

jest.mock('@/lib/python-client', () => ({
  PYTHON_TIMEOUT: { test: 15_000, metadata: 300_000, fetch: 120_000 },
  postToPython: jest.fn(),
}));
const mockedPostToPython = postToPython as jest.Mock;

const STATS_RESPONSE = {
  source_key: 'models/m1/versions/v1/gold/data.parquet',
  column_stats_key: 'models/m1/versions/v1/gold/column_stats.json',
  stats: {
    tag_a: {
      tag: 'tag_a',
      coverage: 1,
      null_pct: 0,
      outlier_count: 0,
      mean: 10,
      std: 2,
      percentiles: { p1: 4, p99: 16 },
      cleaned: true,
    },
  },
};

afterEach(() => {
  jest.clearAllMocks();
  resetColumnBaselineCacheForTests();
});

/**
 * MODEL-SERVE-001-T30. `resolveColumnBaseline` GAINED a cache when
 * `deriveDeployStatuses` (deploy-status.ts) became the first caller to run
 * it on the LIST path — every earlier caller reads one model's baseline
 * once, inside one request, so nothing here was exercised until then.
 */
describe('resolveColumnBaseline caching', () => {
  it('calls the sidecar once for two calls with the same goldObjectKey', async () => {
    mockedPostToPython.mockResolvedValue(STATS_RESPONSE);
    const key = 'models/m1/versions/v1/gold/data.parquet';

    const first = await resolveColumnBaseline(key);
    const second = await resolveColumnBaseline(key);

    expect(mockedPostToPython).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.tag_a).toEqual({
      mean: 10,
      std: 2,
      percentiles: { p1: 4, p99: 16 },
    });
  });

  it('calls the sidecar once per DISTINCT goldObjectKey', async () => {
    mockedPostToPython.mockResolvedValue(STATS_RESPONSE);

    await resolveColumnBaseline('models/m1/versions/v1/gold/data.parquet');
    await resolveColumnBaseline('models/m2/versions/v1/gold/data.parquet');

    expect(mockedPostToPython).toHaveBeenCalledTimes(2);
  });

  // THE PROMISE ITSELF IS CACHED, not only the resolved value — collapsing
  // concurrent callers into ONE in-flight sidecar call is the whole point
  // for `deriveDeployStatuses`'s own `Promise.all` over enabled models.
  it('collapses concurrent calls for the same key into one sidecar call', async () => {
    let resolveResponse!: (v: typeof STATS_RESPONSE) => void;
    mockedPostToPython.mockImplementation(
      () => new Promise((resolve) => (resolveResponse = resolve)),
    );
    const key = 'models/m1/versions/v1/gold/data.parquet';

    const a = resolveColumnBaseline(key);
    const b = resolveColumnBaseline(key);
    resolveResponse(STATS_RESPONSE);
    const [resultA, resultB] = await Promise.all([a, b]);

    expect(mockedPostToPython).toHaveBeenCalledTimes(1);
    expect(resultA).toEqual(resultB);
  });

  // A FAILURE MUST NEVER BE CACHED — a transient sidecar outage would
  // otherwise read as a PERMANENT one until process restart, for an
  // artifact that never actually lost its column_stats.json.
  it('does not cache a failed read — the next call retries', async () => {
    mockedPostToPython.mockRejectedValueOnce(new Error('sidecar unreachable'));
    mockedPostToPython.mockResolvedValueOnce(STATS_RESPONSE);
    const key = 'models/m1/versions/v1/gold/data.parquet';

    const first = await resolveColumnBaseline(key);
    expect(first).toEqual({});

    const second = await resolveColumnBaseline(key);
    expect(second.tag_a).toBeDefined();
    expect(mockedPostToPython).toHaveBeenCalledTimes(2);
  });

  it('resetColumnBaselineCacheForTests clears a warm cache', async () => {
    mockedPostToPython.mockResolvedValue(STATS_RESPONSE);
    const key = 'models/m1/versions/v1/gold/data.parquet';

    await resolveColumnBaseline(key);
    resetColumnBaselineCacheForTests();
    await resolveColumnBaseline(key);

    expect(mockedPostToPython).toHaveBeenCalledTimes(2);
  });
});
