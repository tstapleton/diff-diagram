import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { DashboardNavComponent } from "./dashboard-nav.component";
import { DashboardStatsComponent } from "./dashboard-stats.component";
import { DashboardShellComponent } from "./layout/dashboard-shell.component";

@Component({
	selector: "app-dashboard",
	standalone: true,
	imports: [
		CommonModule,
		DashboardShellComponent,
		DashboardNavComponent,
		DashboardStatsComponent,
	],
	template: `
    <app-dashboard-shell>
      <app-dashboard-nav />
      <app-dashboard-stats />
    </app-dashboard-shell>
  `,
})
export class DashboardComponent {}
