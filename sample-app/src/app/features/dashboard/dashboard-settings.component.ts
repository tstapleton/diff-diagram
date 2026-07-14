import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { ThemeService } from "../../shared/services/theme.service";

@Component({
	selector: "app-dashboard-settings",
	standalone: true,
	imports: [CommonModule],
	providers: [ThemeService],
	template: `
    <div class="dashboard-settings">
      <button type="button" (click)="toggleTheme()">Toggle theme</button>
    </div>
  `,
})
export class DashboardSettingsComponent {
	constructor(private theme: ThemeService) {}

	toggleTheme(): void {
		this.theme.set(this.theme.get() === "dark" ? "light" : "dark");
	}
}
