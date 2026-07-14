import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";

@Component({
	selector: "app-dashboard-nav",
	standalone: true,
	imports: [CommonModule],
	template: `
    <nav class="dashboard-nav">
      <a href="#overview">Overview</a>
      <a href="#reports">Reports</a>
    </nav>
  `,
})
export class DashboardNavComponent {}
