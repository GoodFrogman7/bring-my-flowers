import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';

const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    targets: [
      {
        target: 'pino/file',
        options: { destination: path.join(logDir, 'app.log') },
        level: 'info'
      },
      {
        target: 'pino/file',
        options: { destination: path.join(logDir, 'audit.log') },
        level: 'info'
      },
      {
        target: 'pino-pretty',
        options: { colorize: true },
        level: 'debug'
      }
    ]
  }
});

export default logger;

