import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { ChartPoint } from "../../shared/models/chart-point.model";

@Component({
	selector: "app-dashboard-chart",
	standalone: true,
	imports: [CommonModule],
	template: `
    <div class="dashboard-chart">
      <span *ngFor="let p of points">{{ p.x }},{{ p.y }}</span>
    </div>
  `,
})
export class DashboardChartComponent {
	points: ChartPoint[] = [new ChartPoint(0, 0), new ChartPoint(1, 4)];
}
