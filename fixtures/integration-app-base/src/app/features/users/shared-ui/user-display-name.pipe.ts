import { Pipe, type PipeTransform } from "@angular/core";
import type { UserModel } from "../models/user.model";

@Pipe({ name: "userDisplayName", standalone: true })
export class UserDisplayNamePipe implements PipeTransform {
	transform(user: UserModel): string {
		return `${user.firstName} ${user.lastName}`.trim() || user.email;
	}
}
