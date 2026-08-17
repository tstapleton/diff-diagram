import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";
import type { RoleModel } from "../models/role.model";

@Component({
	selector: "app-user-roles-badge",
	standalone: true,
	imports: [CommonModule],
	template: `<span class="role-badge" *ngFor="let role of roles">{{ role.name }}</span>`,
})
export class UserRolesBadgeComponent {
	@Input() roles: RoleModel[] = [];
}
