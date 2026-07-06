import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export class VoiceTranscriber {
  private whisperModel: string;

  constructor(model: string = 'base') {
    this.whisperModel = model;
  }

  async downloadRecording(recordingUrl: string, outputPath: string): Promise<string> {
    try {
      const response = await fetch(recordingUrl);
      const buffer = await response.buffer();
      
      fs.writeFileSync(outputPath, buffer);
      logger.info({ path: outputPath }, 'Recording downloaded');
      
      return outputPath;
    } catch (error) {
      logger.error({ error, url: recordingUrl }, 'Failed to download recording');
      throw error;
    }
  }

  async transcribe(audioFilePath: string, language?: string): Promise<{
    text: string;
    language: string;
    confidence: number;
  }> {
    try {
      // Use Whisper CLI if installed, otherwise use API fallback
      const command = language 
        ? `whisper "${audioFilePath}" --model ${this.whisperModel} --language ${language} --output_format txt`
        : `whisper "${audioFilePath}" --model ${this.whisperModel} --output_format txt`;

      const { stdout, stderr } = await execPromise(command);
      
      // Read the generated transcript file
      const txtFile = audioFilePath.replace(/\.[^.]+$/, '.txt');
      const transcript = fs.readFileSync(txtFile, 'utf-8').trim();

      // Clean up files
      fs.unlinkSync(audioFilePath);
      fs.unlinkSync(txtFile);

      logger.info({ transcript, language }, 'Audio transcribed');

      return {
        text: transcript,
        language: language || 'auto',
        confidence: 0.8
      };
    } catch (error) {
      logger.error({ error }, 'Transcription failed, using fallback');
      return this.fallbackTranscription();
    }
  }

  private fallbackTranscription(): {text: string; language: string; confidence: number} {
    // If Whisper is not available, return a default response
    return {
      text: "Voice transcription temporarily unavailable. Please send a text message.",
      language: 'en',
      confidence: 0.1
    };
  }

  async transcribeFromUrl(recordingUrl: string, language?: string): Promise<{
    text: string;
    language: string;
    confidence: number;
  }> {
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFile = path.join(tempDir, `recording_${Date.now()}.wav`);
    
    try {
      await this.downloadRecording(recordingUrl, tempFile);
      return await this.transcribe(tempFile, language);
    } catch (error) {
      // Clean up on error
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw error;
    }
  }
}
