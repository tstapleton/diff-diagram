export type BulkActionType = "activate" | "deactivate" | "delete" | "export";

export interface BulkActionModel {
	type: BulkActionType;
	userIds: string[];
	confirmedAt?: string;
}
