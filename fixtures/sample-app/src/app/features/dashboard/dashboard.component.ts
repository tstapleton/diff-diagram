import { CommonModule } from "@angular/common";
import { Component, type OnInit } from "@angular/core";
import { DashboardStatsComponent } from "./dashboard-stats.component";
import { DashboardMetricsService } from "./data-access/dashboard-metrics.service";
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
	providers: [DashboardMetricsService],
	template: `
    <app-dashboard-shell>
      <app-dashboard-stats />
      <app-dashboard-chart />
      <app-dashboard-settings />
    </app-dashboard-shell>
  `,
})
export class DashboardComponent implements OnInit {
	visitCount = 0;

	constructor(private readonly metrics: DashboardMetricsService) {}

	ngOnInit(): void {
		this.visitCount = this.metrics.getVisitCount();
	}
}
