import { Injectable } from "@angular/core";
import { type Observable, of } from "rxjs";
import type { CsvService } from "../../../shared/services/csv.service";
import type { UserModel } from "../models/user.model";
import type { ExportModel } from "./export.model";

@Injectable({ providedIn: "root" })
export class UserExportService {
	constructor(private csv: CsvService) {}

	export(users: UserModel[], config: ExportModel): Observable<void> {
		const rows = users.map((u) => ({
			id: u.id,
			email: u.email,
			firstName: u.firstName,
			lastName: u.lastName,
		}));
		const blob = this.csv.toBlob(rows, config.fields);
		this.csv.download(blob, config.filename);
		return of(undefined);
	}
}
