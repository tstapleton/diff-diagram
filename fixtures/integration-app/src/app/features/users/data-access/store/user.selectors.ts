import type { UserModel } from "../../models/user.model";
import type { UserState } from "./user.state";

export const selectAllUsers = (state: UserState): UserModel[] => state.users;
export const selectSelectedId = (state: UserState): string | null =>
	state.selectedId;
export const selectLoading = (state: UserState): boolean => state.loading;
export const selectError = (state: UserState): string | null => state.error;

export const selectSelectedUser = (state: UserState): UserModel | undefined =>
	state.users.find((u) => u.id === state.selectedId);
