import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";
import type { CardConfig } from "../../shared/models/card-config.model";

@Component({
	selector: "app-dashboard-card",
	standalone: true,
	imports: [CommonModule],
	template: `
    <div class="dashboard-card">
      <span class="dashboard-card__title">{{ config.title }}</span>
    </div>
  `,
})
export class DashboardCardComponent {
	@Input() config!: CardConfig;
}
