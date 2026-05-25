import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UserPreferencesService } from './user-preferences.service';
import { NotificationModel } from './notification.model';
import { NotificationService } from '../../../shared/services/notification.service';

@Component({
  selector: 'app-user-notification-prefs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="notification-prefs">
      <label *ngFor="let n of notifications">
        <input type="checkbox" [checked]="n.enabled" (change)="toggle(n)" />
        {{ n.type }}
      </label>
    </div>
  `,
})
export class UserNotificationPrefsComponent implements OnInit {
  @Input() userId = '';
  notifications: NotificationModel[] = [];

  constructor(
    private prefsService: UserPreferencesService,
    private notificationService: NotificationService,
  ) {}

  ngOnInit(): void {
    this.prefsService.get(this.userId).subscribe();
  }

  toggle(n: NotificationModel): void {
    n.enabled = !n.enabled;
    this.notificationService.success(`Notifications ${n.enabled ? 'enabled' : 'disabled'}`);
  }
}
