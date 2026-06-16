import { Injectable } from "@angular/core";
import { map, type Observable } from "rxjs";
import type { ApiService } from "../../../shared/api/api.service";
import type { UserModel } from "../models/user.model";
import type { UserApiResponseModel } from "./user-api-response.model";

@Injectable({ providedIn: "root" })
export class UsersService {
	private readonly base = "/api/users";

	constructor(private api: ApiService) {}

	getAll(): Observable<UserModel[]> {
		return this.api
			.get<UserApiResponseModel>(this.base)
			.pipe(map((r) => r.data));
	}

	getById(id: string): Observable<UserModel> {
		return this.api.get<UserModel>(`${this.base}/${id}`);
	}

	create(partial: Partial<UserModel>): Observable<UserModel> {
		return this.api.post<UserModel>(this.base, partial);
	}

	update(id: string, partial: Partial<UserModel>): Observable<UserModel> {
		return this.api.put<UserModel>(`${this.base}/${id}`, partial);
	}

	delete(id: string): Observable<void> {
		return this.api.delete<void>(`${this.base}/${id}`);
	}
}
