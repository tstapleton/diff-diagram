import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";
import type { UserModel } from "../models/user.model";
import { UserStatusPipe } from "../shared-ui/user-status.pipe";
import { UserDetailComponent } from "../user-detail/user-detail.component";

@Component({
	selector: "app-user-card",
	standalone: true,
	imports: [CommonModule, UserStatusPipe, UserDetailComponent],
	template: `
    <div class="user-card">
      <span class="user-card__name">{{ user.firstName }} {{ user.lastName }}</span>
      <span class="user-card__status">{{ user.statusId | userStatus:[] }}</span>
    </div>
  `,
})
export class UserCardComponent {
	@Input() user!: UserModel;
}
