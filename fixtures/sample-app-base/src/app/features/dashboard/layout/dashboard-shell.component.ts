import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";

@Component({
	selector: "app-dashboard-shell",
	standalone: true,
	imports: [CommonModule],
	template: `
    <div class="dashboard-shell">
      <ng-content></ng-content>
    </div>
  `,
})
export class DashboardShellComponent {}
