export interface FilterModel {
	query: string;
	statusIds: string[];
	roleIds: string[];
	page: number;
	pageSize: number;
}

export const defaultFilter: FilterModel = {
	query: "",
	statusIds: [],
	roleIds: [],
	page: 1,
	pageSize: 20,
};
