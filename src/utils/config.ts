import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Config } from '../types';

dotenv.config();

export function loadConfig(): Config {
  const configPath = path.join(process.cwd(), 'config', 'settings.json');
  const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // Override with environment variables if present
  if (process.env.OLLAMA_ENDPOINT) {
    config.ollama.endpoint = process.env.OLLAMA_ENDPOINT;
  }
  if (process.env.OLLAMA_MODEL) {
    config.ollama.model = process.env.OLLAMA_MODEL;
  }
  if (process.env.OWNER_NUMBERS) {
    config.whatsapp.owners = process.env.OWNER_NUMBERS.split(',').map(n => n.trim()).filter(n => n);
  }
  if (process.env.EXCEL_FILE_PATH) {
    config.excel.filePath = process.env.EXCEL_FILE_PATH;
  }
  if (process.env.SUMMARY_TIME) {
    config.scheduler.summaryTime = process.env.SUMMARY_TIME;
  }
  if (process.env.SESSION_PATH) {
    config.whatsapp.sessionPath = process.env.SESSION_PATH;
  }
  if (process.env.BACKUP_PATH) {
    config.excel.backupPath = process.env.BACKUP_PATH;
  }

  return config;
}

export function ensureDirectories(config: Config): void {
  const dirs = [
    config.whatsapp.sessionPath,
    config.excel.backupPath,
    path.dirname(config.excel.filePath),
    'logs'
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

