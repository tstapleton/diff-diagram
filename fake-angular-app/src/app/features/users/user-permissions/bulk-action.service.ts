import { Injectable } from "@angular/core";
import { type Observable, of } from "rxjs";
import type { UsersService } from "../data-access/users.service";
import type { BulkActionModel } from "../models/bulk-action.model";
import type { UserModel } from "../models/user.model";

@Injectable({ providedIn: "root" })
export class BulkActionService {
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: fixture stub
	constructor(private usersService: UsersService) {}

	execute(action: BulkActionModel): Observable<UserModel[]> {
		if (action.type === "delete") {
			return of(action.userIds.map((id) => ({ id }) as UserModel));
		}
		return of([]);
	}

	canExecute(action: BulkActionModel, users: UserModel[]): boolean {
		return action.userIds.every((id) => users.some((u) => u.id === id));
	}
}
