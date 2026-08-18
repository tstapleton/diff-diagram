import { Injectable } from "@angular/core";

@Injectable({ providedIn: "root" })
export class ExportHistoryService {
	getLastExportedAt(): Date | null {
		return null;
	}
}
