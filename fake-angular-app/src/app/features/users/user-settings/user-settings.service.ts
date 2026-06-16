import { Injectable } from "@angular/core";
import type { Observable } from "rxjs";
import type { ApiService } from "../../../shared/api/api.service";
import type { UserPreferencesModel } from "./user-preferences.model";

@Injectable({ providedIn: "root" })
export class UserSettingsService {
	constructor(private api: ApiService) {}

	getSettings(userId: string): Observable<UserPreferencesModel> {
		return this.api.get<UserPreferencesModel>(`/api/users/${userId}/settings`);
	}

	updateSettings(
		userId: string,
		settings: Partial<UserPreferencesModel>,
	): Observable<UserPreferencesModel> {
		return this.api.put<UserPreferencesModel>(
			`/api/users/${userId}/settings`,
			settings,
		);
	}
}
