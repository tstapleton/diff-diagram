import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FormErrorsComponent } from "../../../shared/components/form-errors.component";
import type { UserModel } from "../models/user.model";
import { type ValidationError, validateUser } from "./validation.utils";

@Component({
	selector: "app-user-form",
	standalone: true,
	imports: [CommonModule, FormsModule, FormErrorsComponent],
	template: `
    <form (ngSubmit)="onSubmit()">
      <app-form-errors [errors]="errorMessages" />
      <input [(ngModel)]="draft.firstName" name="firstName" placeholder="First name" />
      <input [(ngModel)]="draft.lastName" name="lastName" placeholder="Last name" />
      <input [(ngModel)]="draft.email" name="email" placeholder="Email" />
      <button type="submit">Save</button>
    </form>
  `,
})
export class UserFormComponent {
	@Input() set user(u: Partial<UserModel>) {
		this.draft = { ...u };
	}
	@Output() save = new EventEmitter<Partial<UserModel>>();

	draft: Partial<UserModel> = {};
	errors: ValidationError[] = [];

	get errorMessages(): string[] {
		return this.errors.map((e) => `${e.field}: ${e.message}`);
	}

	onSubmit(): void {
		this.errors = validateUser(this.draft);
		if (!this.errors.length) this.save.emit(this.draft);
	}
}
