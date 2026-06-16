import { Pipe, type PipeTransform } from "@angular/core";
import type { UserStatusModel } from "../models/user-status.model";

@Pipe({ name: "userStatus", standalone: true })
export class UserStatusPipe implements PipeTransform {
	transform(statusId: string, statuses: UserStatusModel[]): string {
		return statuses.find((s) => s.id === statusId)?.label ?? statusId;
	}
}
