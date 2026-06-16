import type { FilterModel } from "../../user-list/filter.model";
import type { UserFilterState } from "./user-filter.reducer";

export const selectFilter = (state: UserFilterState): FilterModel =>
	state.filter;
export const selectFilterQuery = (state: UserFilterState): string =>
	state.filter.query;
export const selectFilterPage = (state: UserFilterState): number =>
	state.filter.page;
export const selectActiveFilters = (
	state: UserFilterState,
): Partial<FilterModel> => {
	const f = state.filter;
	const active: Partial<FilterModel> = {};
	if (f.query) active.query = f.query;
	if (f.statusIds.length) active.statusIds = f.statusIds;
	if (f.roleIds.length) active.roleIds = f.roleIds;
	return active;
};
