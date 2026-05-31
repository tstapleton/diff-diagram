import { UserAction } from './user.actions';
import { UserModel } from '../../models/user.model';
import { UserState, initialUserState } from './user.state';

export function userReducer(state = initialUserState, action: UserAction): UserState {
  switch (action.type) {
    case 'LOAD_USERS':
      return { ...state, loading: true, error: null };
    case 'LOAD_USERS_SUCCESS':
      return { ...state, loading: false, users: action.payload as UserModel[] };
    case 'LOAD_USERS_FAILURE':
      return { ...state, loading: false, error: (action.payload as Error).message };
    case 'SELECT_USER':
      return { ...state, selectedId: action.payload as string };
    default:
      return state;
  }
}
