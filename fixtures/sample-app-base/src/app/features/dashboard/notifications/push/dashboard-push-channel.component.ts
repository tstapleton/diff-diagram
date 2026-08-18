import { CommonModule } from "@angular/common";
import { Component, type OnInit } from "@angular/core";
import { PushBadgeService } from "./push-badge.service";

@Component({
	selector: "app-dashboard-push-channel",
	standalone: true,
	imports: [CommonModule],
	providers: [PushBadgeService],
	template: `
    <div class="push-channel">
      <span class="push-channel__status">Push notifications enabled</span>
      <span class="push-channel__badge">{{ unreadCount }}</span>
    </div>
  `,
})
export class DashboardPushChannelComponent implements OnInit {
	enabled = true;
	unreadCount = 0;

	constructor(private readonly badgeService: PushBadgeService) {}

	ngOnInit(): void {
		this.unreadCount = this.badgeService.getUnreadCount();
	}
}
