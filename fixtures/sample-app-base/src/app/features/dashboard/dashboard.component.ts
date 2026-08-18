import { CommonModule } from "@angular/common";
import { Component, type OnInit } from "@angular/core";
import { DashboardNavComponent } from "./dashboard-nav.component";
import { DashboardStatsComponent } from "./dashboard-stats.component";
import { ExportHistoryService } from "./export/export-history.service";
import { DashboardShellComponent } from "./layout/dashboard-shell.component";
import { LegacySummaryComponent } from "./legacy-summary/legacy-summary.component";

@Component({
	selector: "app-dashboard",
	standalone: true,
	imports: [
		CommonModule,
		DashboardShellComponent,
		DashboardNavComponent,
		DashboardStatsComponent,
		LegacySummaryComponent,
	],
	providers: [ExportHistoryService],
	template: `
    <app-dashboard-shell>
      <app-dashboard-nav />
      <app-dashboard-stats />
      <app-legacy-summary />
      <p class="dashboard__last-exported">Last exported: {{ lastExportedAt }}</p>
    </app-dashboard-shell>
  `,
})
export class DashboardComponent implements OnInit {
	lastExportedAt: Date | null = null;

	constructor(private readonly exportHistory: ExportHistoryService) {}

	ngOnInit(): void {
		this.lastExportedAt = this.exportHistory.getLastExportedAt();
	}
}
