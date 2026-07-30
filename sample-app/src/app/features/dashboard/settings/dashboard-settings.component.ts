import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { ThemeService } from "../../../shared/services/theme.service";
import { DashboardNotificationPrefsComponent } from "./preferences/dashboard-notification-prefs.component";

@Component({
	selector: "app-dashboard-settings",
	standalone: true,
	imports: [CommonModule, DashboardNotificationPrefsComponent],
	providers: [ThemeService],
	template: `
    <div class="dashboard-settings">
      <button type="button" (click)="toggleTheme()">Toggle theme</button>
      <app-dashboard-notification-prefs />
    </div>
  `,
})
export class DashboardSettingsComponent {
	constructor(private theme: ThemeService) {}

	toggleTheme(): void {
		this.theme.set(this.theme.get() === "dark" ? "light" : "dark");
	}
}
