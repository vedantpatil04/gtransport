/** Where a notification is delivered. In-app is the only channel the prototype simulates today. */
export type NotificationChannelName = 'in_app' | 'push' | 'sms';

export interface NotificationMessage {
  /** 'admin' or a driver id, matching the existing audience model. */
  audience: string;
  kind: string;
  params: Record<string, string | number>;
  /** Repeated sends with the same key must not produce duplicates (e.g. daily expiry reminders). */
  dedupeKey?: string;
  link?: string;
}

export interface NotificationChannel {
  readonly name: NotificationChannelName;
  send(message: NotificationMessage): Promise<void>;
}
