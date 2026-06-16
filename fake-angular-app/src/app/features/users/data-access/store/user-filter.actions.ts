import type { FilterModel } from "../../user-list/filter.model";

export type UserFilterActionType = "SET_FILTER" | "RESET_FILTER" | "SET_PAGE";

export interface UserFilterAction {
	type: UserFilterActionType;
	payload?: FilterModel | number;
}

export const setFilter = (filter: FilterModel): UserFilterAction => ({
	type: "SET_FILTER",
	payload: filter,
});
export const resetFilter = (): UserFilterAction => ({ type: "RESET_FILTER" });
export const setPage = (page: number): UserFilterAction => ({
	type: "SET_PAGE",
	payload: page,
});
