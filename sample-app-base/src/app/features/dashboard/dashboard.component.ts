import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { DashboardNavComponent } from "./dashboard-nav.component";
import { DashboardStatsComponent } from "./dashboard-stats.component";

@Component({
	selector: "app-dashboard",
	standalone: true,
	imports: [CommonModule, DashboardNavComponent, DashboardStatsComponent],
	template: `
    <div class="dashboard">
      <app-dashboard-nav />
      <app-dashboard-stats />
    </div>
  `,
})
export class DashboardComponent {}
