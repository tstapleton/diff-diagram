import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import type { EmailDigestFrequency } from "./email-digest.model";

@Component({
	selector: "app-dashboard-email-digest",
	standalone: true,
	imports: [CommonModule],
	template: `
    <div class="email-digest">
      <span>Digest frequency: {{ frequency }}</span>
    </div>
  `,
})
export class DashboardEmailDigestComponent {
	frequency: EmailDigestFrequency = "daily";
}
