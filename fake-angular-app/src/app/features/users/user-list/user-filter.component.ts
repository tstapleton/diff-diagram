import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FilterStateService } from './filter-state.service';
import { FilterModel } from './filter.model';
import { SearchComponent } from '../../../shared/components/search.component';

@Component({
  selector: 'app-user-filter',
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
    this.filterState.filter$.subscribe(f => (this.filter = f));
  }

  onQueryChange(query: string): void {
    this.filterState.patch({ query });
  }
}
