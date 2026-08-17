import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Output } from "@angular/core";
import type { UsersService } from "../data-access/users.service";
import type { UserModel } from "../models/user.model";
import { UserFormComponent } from "./user-form.component";

@Component({
	selector: "app-user-create-dialog",
	standalone: true,
	imports: [CommonModule, UserFormComponent],
	template: `
    <div class="dialog">
      <h2>Create User</h2>
      <app-user-form (save)="onCreate($event)" />
    </div>
  `,
})
export class UserCreateDialogComponent {
	@Output() created = new EventEmitter<UserModel>();

	constructor(private usersService: UsersService) {}

	onCreate(partial: Partial<UserModel>): void {
		this.usersService.create(partial).subscribe((u) => this.created.emit(u));
	}
}
