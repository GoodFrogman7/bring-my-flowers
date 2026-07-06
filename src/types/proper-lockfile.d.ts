declare module 'proper-lockfile' {
  export interface LockOptions {
    retries?: number;
    stale?: number;
    update?: number;
    realpath?: boolean;
    fs?: any;
    onCompromised?: (err: Error) => void;
  }

  export function lock(file: string, options?: LockOptions): Promise<() => Promise<void>>;
  export function unlock(file: string, options?: LockOptions): Promise<void>;
  export function check(file: string, options?: LockOptions): Promise<boolean>;
  export function lockSync(file: string, options?: LockOptions): () => void;
  export function unlockSync(file: string, options?: LockOptions): void;
  export function checkSync(file: string, options?: LockOptions): boolean;
}

