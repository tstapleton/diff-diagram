import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly notifications$ = new Subject<Notification>();

  show(notification: Omit<Notification, 'id'>): void {
    this.notifications$.next({ id: crypto.randomUUID(), ...notification });
  }

  success(message: string): void { this.show({ type: 'success', message }); }
  error(message: string): void { this.show({ type: 'error', message }); }
}
