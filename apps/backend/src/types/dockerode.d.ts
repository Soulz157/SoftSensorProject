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
