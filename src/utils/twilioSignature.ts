import twilio from 'twilio';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import logger from './logger';

/**
 * Twilio signs each webhook with HMAC-SHA1 over the exact public URL plus the
 * sorted POST params. Behind ngrok the URL Twilio signed is the public https
 * one, so we reconstruct it from forwarded headers — or from WEBHOOK_BASE_URL
 * when set (the reliable option; set it to your ngrok/production base URL).
 */
function resolveWebhookUrl(req: Request): string {
  const base = process.env.WEBHOOK_BASE_URL;
  if (base) {
    return `${base.replace(/\/$/, '')}${req.originalUrl}`;
  }
  // req.protocol honors X-Forwarded-Proto because the servers enable 'trust proxy'
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

/**
 * Rejects webhook requests that were not signed by Twilio with our auth token.
 * Without this, anyone who discovers the webhook URL can spoof customer
 * messages, create orders, and drain inventory.
 *
 * Set TWILIO_VALIDATE_WEBHOOK=false to disable for local curl testing only.
 */
export function twilioSignatureValidator(authToken: string): RequestHandler {
  const disabled = process.env.TWILIO_VALIDATE_WEBHOOK === 'false';
  if (disabled) {
    logger.warn('TWILIO_VALIDATE_WEBHOOK=false — webhook signature validation is OFF. Never run like this in production.');
  }

  return (req: Request, res: Response, next: NextFunction) => {
    if (disabled) return next();

    const signature = req.header('X-Twilio-Signature') || '';
    const url = resolveWebhookUrl(req);
    const valid = twilio.validateRequest(authToken, signature, url, req.body || {});

    if (!valid) {
      logger.warn({ url, hasSignature: Boolean(signature) }, 'Rejected webhook with invalid Twilio signature');
      res.status(403).send('Forbidden');
      return;
    }

    next();
  };
}
