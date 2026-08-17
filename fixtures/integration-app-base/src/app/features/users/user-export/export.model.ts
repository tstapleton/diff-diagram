export type ExportFormat = "csv" | "json" | "xlsx";

export interface ExportModel {
	format: ExportFormat;
	fields: string[];
	filterIds?: string[];
	filename: string;
}
