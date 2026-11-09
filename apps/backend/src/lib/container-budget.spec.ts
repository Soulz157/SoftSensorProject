import {
  admit,
  containerProfiles,
  hostTotal,
  jobPriority,
  type ContainerMode,
  type ContainerResources,
  type RunningContainer,
} from './container-budget';

const GIB = 1024 ** 3;

const profiles: Record<ContainerMode, ContainerResources> = {
  train: { cpus: 2, memoryBytes: 4 * GIB },
  batch: { cpus: 1, memoryBytes: 2 * GIB },
  score: { cpus: 1, memoryBytes: 2 * GIB },
  infer: { cpus: 1, memoryBytes: GIB },
};

const budget = {
  total: { cpus: 8, memoryBytes: 10 * GIB },
  heldForMonitoring: { cpus: 1, memoryBytes: GIB },
};

function decide(
  mode: ContainerMode,
  running: RunningContainer[],
  over: Partial<Parameters<typeof admit>[0]> = {},
) {
  return admit({
    mode,
    workspaceId: 'ws1',
    running,
    profiles,
    budget,
    maxActivePerWorkspace: 2,
    ...over,
  });
}

const c = (mode: ContainerMode, workspaceId: string | null = 'other') => ({
  mode,
  workspaceId,
});

describe('admit', () => {
  it('admits when the host is empty', () => {
    expect(decide('train', [])).toEqual({ kind: 'fit' });
  });

  it('says no-room once the memory is reserved, even with CPUs free', () => {
    expect(decide('train', [c('train'), c('train')])).toEqual({
      kind: 'no-room',
    });
  });

  it('says no-room when CPUs run out before memory', () => {
    const tight = {
      total: { cpus: 2, memoryBytes: 100 * GIB },
      heldForMonitoring: { cpus: 0, memoryBytes: 0 },
    };
    expect(decide('train', [c('train')], { budget: tight })).toEqual({
      kind: 'no-room',
    });
  });

  it('keeps the held slice away from background work', () => {
    // 8 of the 9 GiB background may use is taken; 2 more lands in the held slice.
    expect(decide('batch', [c('train'), c('train')])).toEqual({
      kind: 'no-room',
    });
  });

  it('lets inference use the held slice', () => {
    expect(decide('infer', [c('train'), c('train')])).toEqual({ kind: 'fit' });
  });

  it('does not count inference already running against the background limit', () => {
    expect(decide('train', [c('train'), c('infer')])).toEqual({ kind: 'fit' });
  });

  it('still refuses background work that would overflow the host', () => {
    expect(
      decide('train', [c('train'), c('score'), c('score'), c('infer')]),
    ).toEqual({ kind: 'no-room' });
  });

  it('holds a workspace at its cap without reading as a full host', () => {
    expect(decide('batch', [c('train', 'ws1'), c('batch', 'ws1')])).toEqual({
      kind: 'workspace-cap',
    });
  });

  it('reports workspace-cap ahead of no-room, so only that workspace waits', () => {
    expect(decide('train', [c('train', 'ws1'), c('train', 'ws1')])).toEqual({
      kind: 'workspace-cap',
    });
  });

  it('never applies the workspace cap to inference or scoring', () => {
    expect(decide('infer', [c('train', 'ws1'), c('batch', 'ws1')])).toEqual({
      kind: 'fit',
    });
  });

  it('fails a job bigger than the whole budget, naming both numbers', () => {
    const small = {
      total: { cpus: 8, memoryBytes: 4 * GIB },
      heldForMonitoring: { cpus: 1, memoryBytes: GIB },
    };
    const out = decide('train', [], { budget: small });
    expect(out.kind).toBe('too-big');
    expect(out).toMatchObject({
      reason: expect.stringMatching(/4\.0 GiB.*3\.0 GiB/) as string,
    });
  });
});

describe('hostTotal', () => {
  const reserve = { cpus: 1, memoryBytes: 2 * GIB };

  it('subtracts the reserve from what Docker reports', () => {
    expect(
      hostTotal({ dockerCpus: 10, dockerMemoryBytes: 8 * GIB, reserve }),
    ).toEqual({ cpus: 9, memoryBytes: 6 * GIB });
  });

  it('lets each override win on its own', () => {
    expect(
      hostTotal({
        dockerCpus: 10,
        dockerMemoryBytes: 8 * GIB,
        reserve,
        overrideMemoryBytes: 3 * GIB,
      }),
    ).toEqual({ cpus: 9, memoryBytes: 3 * GIB });
  });

  it('never goes negative', () => {
    expect(
      hostTotal({ dockerCpus: 0, dockerMemoryBytes: GIB, reserve }),
    ).toEqual({ cpus: 0, memoryBytes: 0 });
  });
});

describe('jobPriority', () => {
  it('orders live inference, score, batch, train, then backfill', () => {
    const order = [
      jobPriority('infer', true),
      jobPriority('score', true),
      jobPriority('batch', true),
      jobPriority('train', true),
      jobPriority('infer', false),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(5);
    expect(order[0]).toBeGreaterThanOrEqual(1);
  });
});

describe('containerProfiles', () => {
  afterEach(() => {
    delete process.env.TRAINING_MEMORY_BYTES;
    delete process.env.CONTAINER_INFER_CPUS;
  });

  it('reads per-mode overrides', () => {
    process.env.TRAINING_MEMORY_BYTES = String(6 * GIB);
    process.env.CONTAINER_INFER_CPUS = '2';
    const p = containerProfiles();
    expect(p.train.memoryBytes).toBe(6 * GIB);
    expect(p.infer.cpus).toBe(2);
  });
});
