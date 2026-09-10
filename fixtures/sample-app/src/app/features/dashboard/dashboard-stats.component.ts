import { CommonModule } from "@angular/common";
import { Component, type OnInit } from "@angular/core";
import { AnalyticsService } from "../../shared/services/analytics.service";
import { ApiClientService } from "../../shared/services/api-client/api-client.service";
import { HttpClientService } from "../../shared/services/api-client/http/http-client.service";

@Component({
	selector: "app-dashboard-stats",
	standalone: true,
	imports: [CommonModule],
	providers: [AnalyticsService, ApiClientService, HttpClientService],
	template: `
    <div class="dashboard-stats">
      <span class="dashboard-stats__visits">{{ visits }}</span>
    </div>
  `,
})
export class DashboardStatsComponent implements OnInit {
	visits = 0;

	constructor(
		private analytics: AnalyticsService,
		private apiClient: ApiClientService,
		private httpClient: HttpClientService,
	) {}

	ngOnInit(): void {
		this.analytics.page("dashboard-stats");
		void this.apiClient.baseUrl;
		void this.httpClient;
	}
}
