/**
 * Outbound-messaging contract shared by the Baileys and Twilio bots so
 * notifiers and schedulers work with either transport.
 */
export interface MessageSender {
  sendMessage(to: string, message: string): Promise<boolean>;
  sendMessageToMultiple(recipients: string[], message: string): Promise<void>;
  isConnected(): boolean;
  /** Send a file (delivery sheet etc.). Optional — Twilio transport lacks it. */
  sendDocument?(to: string, filePath: string, caption?: string): Promise<boolean>;
}
