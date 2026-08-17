import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";

@Component({
	selector: "app-spinner",
	standalone: true,
	imports: [CommonModule],
	template: `<div class="spinner" [class.spinner--sm]="size === 'sm'"></div>`,
})
export class SpinnerComponent {
	@Input() size: "sm" | "md" | "lg" = "md";
}
