import { CommonModule } from "@angular/common";
import { Component, type OnInit } from "@angular/core";
import type { ActivatedRoute } from "@angular/router";
import type { UsersService } from "../data-access/users.service";
import type { UserModel } from "../models/user.model";
import { UserActivityLogComponent } from "./user-activity-log.component";
import { UserAvatarComponent } from "./user-avatar.component";
import { UserProfileHeaderComponent } from "./user-profile-header.component";
import { UserRolesBadgeComponent } from "./user-roles-badge.component";

@Component({
	selector: "app-user-detail",
	standalone: true,
	imports: [
		CommonModule,
		UserAvatarComponent,
		UserRolesBadgeComponent,
		UserProfileHeaderComponent,
		UserActivityLogComponent,
	],
	template: `
    <div *ngIf="user" class="user-detail">
      <app-user-profile-header [user]="user" />
      <app-user-roles-badge [roles]="[]" />
      <app-user-activity-log [userId]="user.id" />
    </div>
  `,
})
export class UserDetailComponent implements OnInit {
	user: UserModel | null = null;

	constructor(
		private route: ActivatedRoute,
		private usersService: UsersService,
	) {}

	ngOnInit(): void {
		const id = this.route.snapshot.paramMap.get("id") ?? "";
		this.usersService.getById(id).subscribe((u) => (this.user = u));
	}
}
