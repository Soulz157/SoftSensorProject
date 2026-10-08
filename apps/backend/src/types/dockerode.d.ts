declare module 'dockerode' {
  namespace Docker {
    interface Container {
      id: string;
      start(): Promise<void>;
      wait(): Promise<{ StatusCode: number }>;
      logs(opts: {
        stdout?: boolean;
        stderr?: boolean;
        tail?: number;
        follow?: false;
      }): Promise<Buffer>;
      remove(opts?: { force?: boolean }): Promise<void>;
      kill(): Promise<void>;
      /** MODEL-FLOW-011-T04: rejects (404-shaped) when the container no
       * longer exists on the daemon — the boot-reconcile existence check.
       * Only the rejection is used today; the field is a placeholder for a
       * future caller that needs to read live state, not a promise that the
       * shape is complete. */
      inspect(): Promise<{ Id: string; State: { Running: boolean } }>;
    }
    interface Image {
      inspect(): Promise<{ Id: string; RepoDigests?: string[] }>;
    }
  }

  class Docker {
    constructor(opts?: { socketPath?: string });
    getImage(name: string): Docker.Image;
    getContainer(id: string): Docker.Container;
    createContainer(opts: Record<string, unknown>): Promise<Docker.Container>;
    pull(
      ref: string,
      cb: (err: Error | null, stream?: NodeJS.ReadableStream) => void,
    ): void;
    modem: {
      followProgress(
        stream: NodeJS.ReadableStream,
        cb: (err: Error | null) => void,
      ): void;
    };
  }

  export = Docker;
}
