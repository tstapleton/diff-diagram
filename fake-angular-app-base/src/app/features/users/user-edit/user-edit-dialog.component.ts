import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import type { UsersService } from "../data-access/users.service";
import type { UserModel } from "../models/user.model";
import { UserFormComponent } from "./user-form.component";

@Component({
	selector: "app-user-edit-dialog",
	standalone: true,
	imports: [CommonModule, UserFormComponent],
	template: `
    <div class="dialog">
      <h2>Edit User</h2>
      <app-user-form [user]="user" (save)="onSave($event)" />
    </div>
  `,
})
export class UserEditDialogComponent {
	@Input() user!: UserModel;
	@Output() saved = new EventEmitter<UserModel>();

	constructor(private usersService: UsersService) {}

	onSave(partial: Partial<UserModel>): void {
		this.usersService
			.update(this.user.id, partial)
			.subscribe((u) => this.saved.emit(u));
	}
}
