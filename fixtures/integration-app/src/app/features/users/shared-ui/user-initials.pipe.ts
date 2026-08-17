import { Pipe, type PipeTransform } from "@angular/core";

@Pipe({ name: "userInitials", standalone: true })
export class UserInitialsPipe implements PipeTransform {
	transform(firstName: string, lastName: string): string {
		return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
	}
}
