/**
 * Minimal typings for ssh2-sftp-client, which ships no declarations of its own.
 *
 * Only the surface this app uses is declared. `fastPut` and `stat` are the two
 * that matter here: `put` buffers a whole file in memory, which is not viable for
 * an archive containing hundreds of megabytes of audio per episode.
 */
declare module 'ssh2-sftp-client' {
  export interface ConnectConfig {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    privateKey?: string | Buffer;
    passphrase?: string;
    readyTimeout?: number;
    [key: string]: unknown;
  }

  export interface FileStats {
    size: number;
    mode: number;
    isFile: boolean;
    isDirectory: boolean;
    [key: string]: unknown;
  }

  export interface FastPutOptions {
    /** Called as bytes go out, for progress reporting. */
    step?: (transferred: number, chunk: number, total: number) => void;
    concurrency?: number;
    chunkSize?: number;
    [key: string]: unknown;
  }

  export default class SftpClient {
    constructor(name?: string);
    connect(config: ConnectConfig): Promise<unknown>;
    end(): Promise<void>;
    mkdir(path: string, recursive?: boolean): Promise<unknown>;
    stat(remotePath: string): Promise<FileStats>;
    put(data: string | Buffer, remotePath: string): Promise<unknown>;
    fastPut(localPath: string, remotePath: string, options?: FastPutOptions): Promise<unknown>;
  }
}
