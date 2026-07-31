import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ThemeService } from "../../../shared/services/theme.service";
import { DashboardNotificationPrefsComponent } from "./preferences/dashboard-notification-prefs.component";

@Component({
	selector: "app-dashboard-settings",
	standalone: true,
	imports: [CommonModule, FormsModule, DashboardNotificationPrefsComponent],
	providers: [ThemeService],
	template: `
    <div class="dashboard-settings">
      <button type="button" (click)="toggleTheme()">Toggle theme</button>
      <label>
        Density
        <select [(ngModel)]="density">
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          [checked]="autoRefresh"
          (change)="toggleAutoRefresh()"
        />
        Auto-refresh widgets
      </label>
      <app-dashboard-notification-prefs />
    </div>
  `,
})
export class DashboardSettingsComponent {
	density: "comfortable" | "compact" = "comfortable";
	autoRefresh = true;

	constructor(private theme: ThemeService) {}

	toggleTheme(): void {
		this.theme.set(this.theme.get() === "dark" ? "light" : "dark");
	}

	toggleAutoRefresh(): void {
		this.autoRefresh = !this.autoRefresh;
	}
}
