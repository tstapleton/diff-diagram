import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";

@Component({
	selector: "app-dashboard-notification-prefs",
	standalone: true,
	imports: [CommonModule],
	template: `
    <div class="notification-prefs">
      <label>
        <input type="checkbox" checked />
        Email me weekly summaries
      </label>
    </div>
  `,
})
export class DashboardNotificationPrefsComponent {}
