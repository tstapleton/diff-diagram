import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { DashboardStatsComponent } from "./dashboard-stats.component";
import { DashboardSettingsComponent } from "./settings/dashboard-settings.component";
import { DashboardChartComponent } from "./widgets/dashboard-chart.component";

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
