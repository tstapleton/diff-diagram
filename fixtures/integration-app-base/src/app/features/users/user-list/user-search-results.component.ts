import { CommonModule } from "@angular/common";
import { Component, type OnInit } from "@angular/core";
import type { UsersService } from "../data-access/users.service";
import type { UserModel } from "../models/user.model";
import type { FilterStateService } from "./filter-state.service";
import { UserCardComponent } from "./user-card.component";
import { matchesFilter } from "./user-search.utils";

@Component({
	selector: "app-user-search-results",
	standalone: true,
	imports: [CommonModule, UserCardComponent],
	template: `
    <div class="search-results">
      <app-user-card *ngFor="let user of results" [user]="user" />
    </div>
  `,
})
export class UserSearchResultsComponent implements OnInit {
	results: UserModel[] = [];

	constructor(
		private users: UsersService,
		private filterState: FilterStateService,
	) {}

	ngOnInit(): void {
		this.users.getAll().subscribe((all) => {
			this.filterState.filter$.subscribe((f) => {
				this.results = all.filter((u) => matchesFilter(u, f));
			});
		});
	}
}
