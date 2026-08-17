import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { ChartPoint } from "../../../shared/models/chart-point.model";

@Component({
	selector: "app-dashboard-chart",
	standalone: true,
	imports: [CommonModule],
	template: `
    <div class="dashboard-chart">
      <span class="dashboard-chart__summary">{{ summary() }}</span>
      <span *ngFor="let p of points">{{ p.x }},{{ p.y }}</span>
    </div>
  `,
})
export class DashboardChartComponent {
	points: ChartPoint[] = [new ChartPoint(0, 0), new ChartPoint(1, 4)];

	summary(): string {
		const xs = this.points.map((p) => p.x);
		const ys = this.points.map((p) => p.y);
		return `x: ${Math.min(...xs)}–${Math.max(...xs)}, y: ${Math.min(...ys)}–${Math.max(...ys)}`;
	}
}
