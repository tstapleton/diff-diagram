import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { DashboardStatsComponent } from "./dashboard-stats.component";
import { DashboardShellComponent } from "./layout/dashboard-shell.component";
import { DashboardSettingsComponent } from "./settings/dashboard-settings.component";
import { DashboardChartComponent } from "./widgets/dashboard-chart.component";

@Component({
	selector: "app-dashboard",
	standalone: true,
	imports: [
		CommonModule,
		DashboardShellComponent,
		DashboardStatsComponent,
		DashboardChartComponent,
		DashboardSettingsComponent,
	],
	template: `
    <app-dashboard-shell>
      <app-dashboard-stats />
      <app-dashboard-chart />
      <app-dashboard-settings />
    </app-dashboard-shell>
  `,
})
export class DashboardComponent {}
