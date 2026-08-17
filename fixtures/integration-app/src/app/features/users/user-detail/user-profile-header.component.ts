import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";
import type { UserModel } from "../models/user.model";
import { UserAvatarComponent } from "./user-avatar.component";

@Component({
	selector: "app-user-profile-header",
	standalone: true,
	imports: [CommonModule, UserAvatarComponent],
	template: `
    <div class="profile-header">
      <app-user-avatar [src]="user.avatarUrl" [initials]="user.firstName[0] + user.lastName[0]" />
      <h2>{{ user.firstName }} {{ user.lastName }}</h2>
      <p>{{ user.email }}</p>
    </div>
  `,
})
export class UserProfileHeaderComponent {
	@Input() user!: UserModel;
}
