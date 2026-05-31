import { UserModel } from '../../models/user.model';

export type UserActionType =
  | 'LOAD_USERS'
  | 'LOAD_USERS_SUCCESS'
  | 'LOAD_USERS_FAILURE'
  | 'SELECT_USER'
  | 'DESELECT_USER';

export interface UserAction {
  type: UserActionType;
  payload?: UserModel | UserModel[] | string | Error;
}

export const loadUsers = (): UserAction => ({ type: 'LOAD_USERS' });
export const loadUsersSuccess = (users: UserModel[]): UserAction => ({ type: 'LOAD_USERS_SUCCESS', payload: users });
export const loadUsersFailure = (error: Error): UserAction => ({ type: 'LOAD_USERS_FAILURE', payload: error });
export const selectUser = (id: string): UserAction => ({ type: 'SELECT_USER', payload: id });
