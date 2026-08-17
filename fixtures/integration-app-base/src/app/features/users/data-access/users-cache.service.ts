import { Injectable } from "@angular/core";
import { type Observable, of, tap } from "rxjs";
import type { CacheService } from "../../../shared/services/cache.service";
import type { UserModel } from "../models/user.model";
import type { UsersService } from "./users.service";

@Injectable({ providedIn: "root" })
export class UsersCacheService {
	private readonly KEY = "users_all";

	constructor(
		private usersService: UsersService,
		private cache: CacheService,
	) {}

	getAll(): Observable<UserModel[]> {
		const cached = this.cache.get<UserModel[]>(this.KEY);
		if (cached) return of(cached);
		return this.usersService
			.getAll()
			.pipe(tap((users) => this.cache.set(this.KEY, users)));
	}

	invalidate(): void {
		this.cache.invalidate(this.KEY);
	}
}
