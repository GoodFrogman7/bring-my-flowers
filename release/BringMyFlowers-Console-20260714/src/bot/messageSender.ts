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
  /**
   * Send a pre-approved WhatsApp template. Cloud API requires templates for
   * business-initiated messages outside the 24-hour customer-service window.
   */
  sendTemplate?(
    to: string,
    templateName: string,
    languageCode?: string,
    components?: unknown[]
  ): Promise<boolean>;
}
