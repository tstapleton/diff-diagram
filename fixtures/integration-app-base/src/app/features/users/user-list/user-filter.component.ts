import { CommonModule } from "@angular/common";
import { Component, type OnInit } from "@angular/core";
import { SearchComponent } from "../../../shared/components/search.component";
import type { FilterModel } from "./filter.model";
import type { FilterStateService } from "./filter-state.service";

@Component({
	selector: "app-user-filter",
	standalone: true,
	imports: [CommonModule, SearchComponent],
	template: `
    <div class="user-filter">
      <app-search [query]="filter.query" (queryChange)="onQueryChange($event)" />
    </div>
  `,
})
export class UserFilterComponent implements OnInit {
	filter!: FilterModel;

	constructor(private filterState: FilterStateService) {}

	ngOnInit(): void {
		this.filterState.filter$.subscribe((f) => (this.filter = f));
	}

	onQueryChange(query: string): void {
		this.filterState.patch({ query });
	}
}
