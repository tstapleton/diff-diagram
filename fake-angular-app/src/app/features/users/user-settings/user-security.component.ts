import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";
import type { AuthService } from "../../../shared/services/auth.service";
import type { UsersService } from "../data-access/users.service";

@Component({
	selector: "app-user-security",
	standalone: true,
	imports: [CommonModule],
	template: `
    <div class="user-security">
      <p>Logged in as: {{ currentUser?.email }}</p>
      <button (click)="logout()">Log out</button>
    </div>
  `,
})
export class UserSecurityComponent {
	@Input() userId = "";

	constructor(
		// biome-ignore lint/correctness/noUnusedPrivateClassMembers: fixture stub
		private usersService: UsersService,
		private auth: AuthService,
	) {}

	get currentUser() {
		return this.auth.getUser();
	}

	logout(): void {
		this.auth.logout().subscribe();
	}
}
