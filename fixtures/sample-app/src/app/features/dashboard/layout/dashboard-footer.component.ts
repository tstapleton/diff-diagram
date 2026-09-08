import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";

@Component({
	selector: "app-dashboard-footer",
	standalone: true,
	imports: [CommonModule],
	template: `
    <footer class="dashboard-footer">
      <span>&copy; Acme dashboards</span>
    </footer>
  `,
})
export class DashboardFooterComponent {}
