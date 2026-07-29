import { CommonModule } from "@angular/common";
import { Component, type OnInit } from "@angular/core";
import { AnalyticsService } from "../../shared/services/analytics.service";

@Component({
	selector: "app-dashboard-stats",
	standalone: true,
	imports: [CommonModule],
	providers: [AnalyticsService],
	template: `
    <div class="dashboard-stats">
      <span class="dashboard-stats__visits">{{ visits }}</span>
    </div>
  `,
})
export class DashboardStatsComponent implements OnInit {
	visits = 0;

	constructor(private analytics: AnalyticsService) {}

	ngOnInit(): void {
		this.analytics.page("dashboard-stats");
	}
}
