import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { UserModel } from "../models/user.model";
import type { ExportModel } from "./export.model";
import type { UserExportService } from "./user-export.service";

@Component({
	selector: "app-user-export-dialog",
	standalone: true,
	imports: [CommonModule, FormsModule],
	template: `
    <div class="dialog">
      <h2>Export Users</h2>
      <select [(ngModel)]="format">
        <option value="csv">CSV</option>
        <option value="json">JSON</option>
      </select>
      <button (click)="doExport()">Export</button>
    </div>
  `,
})
export class UserExportDialogComponent {
	@Input() users: UserModel[] = [];
	@Output() exported = new EventEmitter<void>();

	format: ExportModel["format"] = "csv";

	constructor(private exportService: UserExportService) {}

	doExport(): void {
		const config: ExportModel = {
			format: this.format,
			fields: ["id", "email", "firstName", "lastName"],
			filename: `users.${this.format}`,
		};
		this.exportService
			.export(this.users, config)
			.subscribe(() => this.exported.emit());
	}
}
