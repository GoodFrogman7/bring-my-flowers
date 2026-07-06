/**
 * Outbound-messaging contract shared by the Baileys and Twilio bots so
 * notifiers and schedulers work with either transport.
 */
export interface MessageSender {
  sendMessage(to: string, message: string): Promise<boolean>;
  sendMessageToMultiple(recipients: string[], message: string): Promise<void>;
  isConnected(): boolean;
}
