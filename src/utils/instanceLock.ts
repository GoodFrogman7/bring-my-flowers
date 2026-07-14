import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

/**
 * Single-instance lock for business mode. Prevents two bots fighting over
 * WhatsApp / port 8787. Stale locks (dead PID) are cleared automatically.
 */
export function acquireBusinessLock(lockDir = './data'): () => void {
  fs.mkdirSync(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, 'business.lock');

  if (fs.existsSync(lockPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid: number };
      try {
        process.kill(existing.pid, 0);
        logger.error({ pid: existing.pid, lockPath }, 'Another business bot is already running');
        console.error(`\n❌ Bring My Flowers is already running (pid ${existing.pid}).\n   Close that copy or delete ${lockPath} if it is stale.\n`);
        process.exit(1);
      } catch {
        // process is dead — stale lock
      }
    } catch {
      // unreadable lock — replace
    }
  }

  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const release = () => {
    try {
      if (fs.existsSync(lockPath)) {
        const data = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid: number };
        if (data.pid === process.pid) fs.unlinkSync(lockPath);
      }
    } catch {
      // ignore
    }
  };
  process.on('exit', release);
  return release;
}
