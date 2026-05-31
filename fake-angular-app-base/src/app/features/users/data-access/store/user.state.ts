import { UserModel } from '../../models/user.model';

export interface UserState {
  users: UserModel[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
}

export const initialUserState: UserState = {
  users: [],
  selectedId: null,
  loading: false,
  error: null,
};
