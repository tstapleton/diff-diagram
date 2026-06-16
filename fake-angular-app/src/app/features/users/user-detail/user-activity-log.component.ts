import { CommonModule } from "@angular/common";
import { Component, Input, type OnInit } from "@angular/core";
import type { AuditEventModel } from "./audit-event.model";
import type { UserAuditService } from "./user-audit.service";

@Component({
	selector: "app-user-activity-log",
	standalone: true,
	imports: [CommonModule],
	template: `
    <ul class="activity-log">
      <li *ngFor="let event of events">{{ event.action }} — {{ event.performedAt }}</li>
    </ul>
  `,
})
export class UserActivityLogComponent implements OnInit {
	@Input() userId = "";
	events: AuditEventModel[] = [];

	constructor(private auditService: UserAuditService) {}

	ngOnInit(): void {
		this.auditService
			.getEvents({ id: this.userId } as never)
			.subscribe((e) => (this.events = e));
	}
}
