import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";

@Component({
	selector: "app-form-errors",
	standalone: true,
	imports: [CommonModule],
	template: `<ul class="form-errors"><li *ngFor="let e of errors">{{ e }}</li></ul>`,
})
export class FormErrorsComponent {
	@Input() errors: string[] = [];
}
