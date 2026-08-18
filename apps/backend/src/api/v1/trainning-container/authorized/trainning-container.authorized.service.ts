import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Docker from 'dockerode';
import { PrismaService } from '@softsensor/prisma';

/**
 * Spawns training containers over the Docker socket.
 *
 * The socket is root-equivalent on the host, so everything here is written on
 * the assumption that the IMAGE is trusted but the CODE INSIDE IT may not
 * behave: no host binds, all capabilities dropped, no privilege escalation,
 * hard memory/CPU/pid caps, and a tmpfs for scratch instead of a writable
 * rootfs. The container reaches exactly two things — the NestJS internal API
 * and MinIO — and gets no credential for either beyond a single-run token.
 */

@Injectable()
export class TrainningContainerAuthorizedService implements OnModuleInit {
  private readonly log = new Logger(TrainningContainerAuthorizedService.name);
  private readonly docker = new Docker({ socketPath: '/var/run/docker.sock' });

  /** Digest, resolved once at boot. See resolveDigest. */
  imageDigest = '';

  private readonly imageRef =
    process.env.TRAINING_IMAGE ?? 'scgc/soft-sensor-trainer:1.0.0';
  private readonly network = process.env.TRAINING_NETWORK ?? 'dslake_default';
  private readonly memoryBytes = Number(
    process.env.TRAINING_MEMORY_BYTES ?? 8 * 1024 ** 3,
  );
  private readonly nanoCpus = Number(process.env.TRAINING_NANO_CPUS ?? 2 * 1e9);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.resolveDigest();
  }

  /**
   * Pin the tag to a digest ONCE, at boot.
   *
   * A tag is a moving pointer: two runs recording `:1.0.0` can have executed
   * different code. Recording the digest on every run is what makes
   * imageDigest a reproducibility claim rather than a label.
   */
  private async resolveDigest() {
    try {
      const info = await this.docker.getImage(this.imageRef).inspect();
      this.imageDigest = info.RepoDigests?.[0] ?? info.Id;
    } catch {
      this.log.warn(`Image ${this.imageRef} not present locally — pulling`);
      await new Promise<void>((res, rej) =>
        this.docker.pull(
          this.imageRef,
          (err: unknown, stream: NodeJS.ReadableStream) =>
            err instanceof Error
              ? rej(err)
              : this.docker.modem.followProgress(stream, (e) =>
                  e ? rej(e) : res(),
                ),
        ),
      );
      const info = await this.docker.getImage(this.imageRef).inspect();
      this.imageDigest = info.RepoDigests?.[0] ?? info.Id;
    }
    this.log.log(`Training image pinned to ${this.imageDigest}`);
  }

  async spawn(runId: string, token: string) {
    const container = await this.docker.createContainer({
      Image: this.imageDigest || this.imageRef,
      name: `train-${runId}`,
      Env: [
        `RUN_ID=${runId}`,
        `RUN_TOKEN=${token}`,
        `API_BASE=${process.env.INTERNAL_API_BASE ?? 'http://backend:3000'}`,
      ],
      Labels: { 'dslake.role': 'training', 'dslake.runId': runId },
      HostConfig: {
        NetworkMode: this.network,
        // No host filesystem, ever. Everything the run needs arrives over
        // HTTP; everything it produces leaves the same way.
        Binds: [],
        Memory: this.memoryBytes,
        MemorySwap: this.memoryBytes, // no swap — an OOM should fail, not thrash
        NanoCpus: this.nanoCpus,
        PidsLimit: 512,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        ReadonlyRootfs: true,
        // The one writable path, capped and in RAM. This is where
        // data.parquet is staged — size it above your largest artifact.
        Tmpfs: { '/scratch': 'rw,size=2g,mode=1777' },
        // Kept after exit on purpose: the exit code and docker logs are the
        // only evidence left when a container dies before it can POST
        // /complete. Reaped by `reap()` below.
        AutoRemove: false,
      },
    });

    await container.start();
    await this.prisma.modelTrainingRun.update({
      where: { id: runId },
      data: {
        status: 'RUNNING',
        containerId: container.id,
        startedAt: new Date(),
      },
    });

    void this.watch(runId, container);
  }

  /**
   * Observe the exit code.
   *
   * The container reports its own outcome via /complete, but a process that
   * is OOM-killed or segfaults never gets to. Without this, such a run stays
   * RUNNING forever. `/complete` having already landed wins — this only
   * fills a gap, it does not overrule a real report.
   */
  private async watch(runId: string, container: Docker.Container) {
    try {
      const { StatusCode } = await container.wait();
      const run = await this.prisma.modelTrainingRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (run && (run.status === 'RUNNING' || run.status === 'QUEUED')) {
        const tail = await this.tailLogs(container);
        await this.prisma.modelTrainingRun.update({
          where: { id: runId },
          data: {
            status: StatusCode === 0 ? 'FAILED' : 'FAILED',
            failureReason:
              StatusCode === 0
                ? `Container exited 0 without reporting a result. Tail: ${tail}`
                : `Container exited ${StatusCode}. Tail: ${tail}`,
            finishedAt: new Date(),
          },
        });
      }
    } catch (err) {
      this.log.error(`watch failed for run ${runId}`, err);
    } finally {
      await this.reap(container);
    }
  }

  private async tailLogs(container: Docker.Container): Promise<string> {
    try {
      const buf = await container.logs({
        stdout: true,
        stderr: true,
        tail: 40,
      });
      return buf.toString('utf8').slice(-2000);
    } catch {
      return '(logs unavailable)';
    }
  }

  private async reap(container: Docker.Container) {
    try {
      await container.remove({ force: true });
    } catch {
      /* already gone */
    }
  }

  async kill(containerId: string) {
    try {
      await this.docker.getContainer(containerId).kill();
    } catch (err) {
      this.log.warn(`kill ${containerId}: ${(err as Error).message}`);
    }
  }
}
