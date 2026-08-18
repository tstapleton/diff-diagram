import { CommonModule } from "@angular/common";
import { Component, type OnInit } from "@angular/core";
import { DashboardStatsComponent } from "./dashboard-stats.component";
import { DashboardMetricsService } from "./data-access/dashboard-metrics.service";
import { ExportButtonComponent } from "./export/export-button.component";
import { ExportHistoryService } from "./export/export-history.service";
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
		ExportButtonComponent,
	],
	providers: [DashboardMetricsService, ExportHistoryService],
	template: `
    <app-dashboard-shell>
      <app-dashboard-stats />
      <app-dashboard-chart />
      <app-dashboard-settings />
      <app-export-button />
      <p class="dashboard__last-exported">Last exported: {{ lastExportedAt }}</p>
    </app-dashboard-shell>
  `,
})
export class DashboardComponent implements OnInit {
	visitCount = 0;
	lastExportedAt: Date | null = null;

	constructor(
		private readonly metrics: DashboardMetricsService,
		private readonly exportHistory: ExportHistoryService,
	) {}

	ngOnInit(): void {
		this.visitCount = this.metrics.getVisitCount();
		this.lastExportedAt = this.exportHistory.getLastExportedAt();
	}
}
