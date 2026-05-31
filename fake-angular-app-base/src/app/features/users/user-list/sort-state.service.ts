import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SortModel, defaultSort } from './sort.model';

@Injectable({ providedIn: 'root' })
export class SortStateService {
  private state = new BehaviorSubject<SortModel>(defaultSort);
  readonly sort$ = this.state.asObservable();

  set(sort: SortModel): void {
    this.state.next(sort);
  }

  toggle(field: string): void {
    const current = this.state.value;
    this.state.next({
      field,
      direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc',
    });
  }
}
