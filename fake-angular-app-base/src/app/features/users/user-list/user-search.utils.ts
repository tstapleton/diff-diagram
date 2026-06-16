import type { UserModel } from "../models/user.model";
import type { FilterModel } from "./filter.model";

export function matchesFilter(user: UserModel, filter: FilterModel): boolean {
	const q = filter.query.toLowerCase();
	if (
		q &&
		!`${user.firstName} ${user.lastName} ${user.email}`
			.toLowerCase()
			.includes(q)
	)
		return false;
	if (filter.statusIds.length && !filter.statusIds.includes(user.statusId))
		return false;
	if (
		filter.roleIds.length &&
		!user.roleIds.some((r) => filter.roleIds.includes(r))
	)
		return false;
	return true;
}
