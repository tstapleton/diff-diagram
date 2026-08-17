import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";
import type { PermissionsService } from "../../../shared/services/permissions.service";
import type { BulkActionModel } from "../models/bulk-action.model";
import type { BulkActionService } from "./bulk-action.service";

@Component({
	selector: "app-user-bulk-actions",
	standalone: true,
	imports: [CommonModule],
	template: `
    <div class="bulk-actions" *ngIf="canBulk">
      <button (click)="deactivate()">Deactivate selected</button>
      <button (click)="export()">Export selected</button>
    </div>
  `,
})
export class UserBulkActionsComponent {
	@Input() selectedIds: string[] = [];

	constructor(
		private bulkActions: BulkActionService,
		private permissions: PermissionsService,
	) {}

	get canBulk(): boolean {
		return this.permissions.can("user:admin");
	}

	deactivate(): void {
		const action: BulkActionModel = {
			type: "deactivate",
			userIds: this.selectedIds,
		};
		this.bulkActions.execute(action).subscribe();
	}

	export(): void {
		const action: BulkActionModel = {
			type: "export",
			userIds: this.selectedIds,
		};
		this.bulkActions.execute(action).subscribe();
	}
}
