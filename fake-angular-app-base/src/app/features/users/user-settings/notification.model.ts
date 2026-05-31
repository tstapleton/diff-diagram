export type NotificationChannel = 'email' | 'push' | 'sms';

export interface NotificationModel {
  id: string;
  userId: string;
  channel: NotificationChannel;
  type: string;
  enabled: boolean;
}
