import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";

@Component({
	selector: "app-badge",
	standalone: true,
	imports: [CommonModule],
	template: `<span class="badge badge--{{ variant }}">{{ label }}</span>`,
})
export class BadgeComponent {
	@Input() label = "";
	@Input() variant: "default" | "success" | "warning" | "danger" = "default";
}
