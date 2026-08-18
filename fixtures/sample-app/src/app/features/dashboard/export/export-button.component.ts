import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { ExportHistoryService } from "./export-history.service";

@Component({
	selector: "app-export-button",
	standalone: true,
	imports: [CommonModule],
	providers: [ExportHistoryService],
	template: `
    <button type="button" (click)="export()">Export dashboard</button>
  `,
})
export class ExportButtonComponent {
	constructor(private readonly history: ExportHistoryService) {}

	export(): void {
		this.history.getLastExportedAt();
	}
}
