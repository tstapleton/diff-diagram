import { CommonModule } from "@angular/common";
import { Component, type OnInit } from "@angular/core";
import { PaginationComponent } from "../../../shared/components/pagination.component";
import type { AnalyticsService } from "../../../shared/services";
import type { UsersService } from "../data-access/users.service";
import type { UserModel } from "../models/user.model";
import { UserCardComponent } from "./user-card.component";
import { UserFilterComponent } from "./user-filter.component";
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
          <tr *ngFor="let user of users">
            <td><app-user-card [user]="user" /></td>
          </tr>
        </tbody>
      </table>
      <app-pagination [page]="page" [totalPages]="totalPages" (pageChange)="onPageChange($event)" />
    </div>
  `,
})
export class UsersListComponent implements OnInit {
	users: UserModel[] = [];
	page = 1;
	totalPages = 1;

	constructor(
		private usersService: UsersService,
		// biome-ignore lint/correctness/noUnusedPrivateClassMembers: fixture stub
		private analytics: AnalyticsService,
	) {}

	ngOnInit(): void {
		this.usersService.getAll().subscribe((users) => {
			this.users = users;
			this.totalPages = Math.ceil(users.length / 20);
		});
	}

	onPageChange(page: number): void {
		this.page = page;
	}
}
