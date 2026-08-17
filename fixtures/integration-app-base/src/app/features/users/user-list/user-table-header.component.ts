import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import type { SortModel } from "./sort.model";
import type { SortStateService } from "./sort-state.service";

@Component({
	selector: "app-user-table-header",
	standalone: true,
	imports: [CommonModule],
	template: `
    <thead>
      <tr>
        <th (click)="sort('lastName')">Name</th>
        <th (click)="sort('email')">Email</th>
        <th (click)="sort('statusId')">Status</th>
      </tr>
    </thead>
  `,
})
export class UserTableHeaderComponent {
	currentSort!: SortModel;

	constructor(private sortState: SortStateService) {
		this.sortState.sort$.subscribe((s) => (this.currentSort = s));
	}

	sort(field: string): void {
		this.sortState.toggle(field);
	}
}
