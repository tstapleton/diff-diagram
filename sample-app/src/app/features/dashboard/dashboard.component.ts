import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { DashboardChartComponent } from "./dashboard-chart.component";
import { DashboardSettingsComponent } from "./dashboard-settings.component";
import { DashboardStatsComponent } from "./dashboard-stats.component";

@Component({
	selector: "app-dashboard",
	standalone: true,
	imports: [
		CommonModule,
		DashboardStatsComponent,
		DashboardChartComponent,
		DashboardSettingsComponent,
	],
	template: `
    <div class="dashboard">
      <app-dashboard-stats />
      <app-dashboard-chart />
      <app-dashboard-settings />
    </div>
  `,
})
export class DashboardComponent {}
