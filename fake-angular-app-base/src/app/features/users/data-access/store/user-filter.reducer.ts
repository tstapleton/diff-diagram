import { UserFilterAction } from './user-filter.actions';
import { FilterModel, defaultFilter } from '../../user-list/filter.model';

export interface UserFilterState {
  filter: FilterModel;
}

const initial: UserFilterState = { filter: defaultFilter };

export function userFilterReducer(state = initial, action: UserFilterAction): UserFilterState {
  switch (action.type) {
    case 'SET_FILTER':
      return { ...state, filter: action.payload as FilterModel };
    case 'RESET_FILTER':
      return { ...state, filter: defaultFilter };
    case 'SET_PAGE':
      return { ...state, filter: { ...state.filter, page: action.payload as number } };
    default:
      return state;
  }
}
