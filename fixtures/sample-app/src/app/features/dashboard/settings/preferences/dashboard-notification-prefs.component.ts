import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import type { NotificationPrefs } from "./notification-prefs.model";

@Component({
	selector: "app-dashboard-notification-prefs",
	standalone: true,
	imports: [CommonModule],
	template: `
    <div class="notification-prefs">
      <label>
        <input
          type="checkbox"
          [checked]="prefs.weeklySummary"
          (change)="toggle('weeklySummary')"
        />
        Email me weekly summaries
      </label>
      <label>
        <input
          type="checkbox"
          [checked]="prefs.mentions"
          (change)="toggle('mentions')"
        />
        Notify me on mentions
      </label>
      <label>
        <input
          type="checkbox"
          [checked]="prefs.digest"
          (change)="toggle('digest')"
        />
        Send a daily digest
      </label>
    </div>
  `,
})
export class DashboardNotificationPrefsComponent {
	prefs: NotificationPrefs = {
		weeklySummary: true,
		mentions: true,
		digest: false,
	};

	toggle(key: keyof NotificationPrefs): void {
		this.prefs[key] = !this.prefs[key];
	}
}
