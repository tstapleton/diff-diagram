import { CommonModule } from "@angular/common";
import { Component, type OnInit } from "@angular/core";
import { combineLatest } from "rxjs";
import { PaginationComponent } from "../../../shared/components/pagination.component";
import type { AnalyticsService } from "../../../shared/services";
import type { UsersService } from "../data-access/users.service";
import type { UserModel } from "../models/user.model";
import type { SortStateService } from "./sort-state.service";
import { UserCardComponent } from "./user-card.component";
import { UserFilterComponent } from "./user-filter.component";
import { sortComparator } from "./user-sort.utils";
import { UserTableHeaderComponent } from "./user-table-header.component";

@Component({
	selector: "app-users-list",
	standalone: true,
	imports: [
		CommonModule,
		UserCardComponent,
		UserFilterComponent,
		UserTableHeaderComponent,
		PaginationComponent,
	],
	template: `
    <div class="users-list">
      <app-user-filter />
      <table>
        <app-user-table-header />
        <tbody>
          <tr
            *ngFor="let user of sortedUsers; trackBy: trackByUserId"
            [class.selected]="isSelected(user)"
          >
            <td>
              <input
                type="checkbox"
                [checked]="isSelected(user)"
                (change)="toggleSelect(user)"
              />
            </td>
            <td><app-user-card [user]="user" /></td>
          </tr>
        </tbody>
      </table>
      <div class="bulk-bar" *ngIf="selectedIds.size > 0">
        <span>{{ selectedIds.size }} selected</span>
        <button type="button" (click)="clearSelection()">Clear</button>
      </div>
      <app-pagination [page]="page" [totalPages]="totalPages" (pageChange)="onPageChange($event)" />
    </div>
  `,
})
export class UsersListComponent implements OnInit {
	users: UserModel[] = [];
	sortedUsers: UserModel[] = [];
	selectedIds = new Set<string>();
	page = 1;
	totalPages = 1;

	constructor(
		private usersService: UsersService,
		private sortState: SortStateService,
		// biome-ignore lint/correctness/noUnusedPrivateClassMembers: fixture stub
		private analytics: AnalyticsService,
	) {}

	ngOnInit(): void {
		combineLatest([this.usersService.getAll(), this.sortState.sort$]).subscribe(
			([users, sort]) => {
				this.users = users;
				this.sortedUsers = [...users].sort(sortComparator(sort));
				this.totalPages = Math.ceil(users.length / 20);
			},
		);
	}

	onPageChange(page: number): void {
		this.page = page;
	}

	toggleSelect(user: UserModel): void {
		if (this.selectedIds.has(user.id)) {
			this.selectedIds.delete(user.id);
		} else {
			this.selectedIds.add(user.id);
		}
	}

	isSelected(user: UserModel): boolean {
		return this.selectedIds.has(user.id);
	}

	clearSelection(): void {
		this.selectedIds.clear();
	}

	trackByUserId(_index: number, user: UserModel): string {
		return user.id;
	}
}
