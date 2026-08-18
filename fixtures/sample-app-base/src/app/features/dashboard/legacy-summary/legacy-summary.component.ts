import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { LegacySummaryService } from "./legacy-summary.service";

@Component({
	selector: "app-legacy-summary",
	standalone: true,
	imports: [CommonModule],
	providers: [LegacySummaryService],
	template: `
    <p class="legacy-summary">{{ summary }}</p>
  `,
})
export class LegacySummaryComponent {
	summary: string;

	constructor(private readonly legacy: LegacySummaryService) {
		this.summary = this.legacy.getSummaryText();
	}
}
