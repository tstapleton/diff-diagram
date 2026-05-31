import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { FilterModel, defaultFilter } from './filter.model';

@Injectable({ providedIn: 'root' })
export class FilterStateService {
  private state = new BehaviorSubject<FilterModel>(defaultFilter);
  readonly filter$ = this.state.asObservable();

  patch(partial: Partial<FilterModel>): void {
    this.state.next({ ...this.state.value, ...partial });
  }

  reset(): void {
    this.state.next(defaultFilter);
  }

  snapshot(): FilterModel {
    return this.state.value;
  }
}
