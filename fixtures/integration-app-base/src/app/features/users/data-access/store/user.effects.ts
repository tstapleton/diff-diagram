import { Injectable } from "@angular/core";
import type { UsersService } from "../users.service";
import {
	loadUsersFailure,
	loadUsersSuccess,
	type UserAction,
} from "./user.actions";

@Injectable()
export class UserEffects {
	constructor(private usersService: UsersService) {}

	handleLoadUsers(): void {
		this.usersService.getAll().subscribe({
			next: (users) => this.dispatch(loadUsersSuccess(users)),
			error: (err: Error) => this.dispatch(loadUsersFailure(err)),
		});
	}

	private dispatch(action: UserAction): void {
		console.debug("[UserEffects]", action.type);
	}
}
