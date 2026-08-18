import { Injectable } from "@angular/core";

@Injectable({ providedIn: "root" })
export class PushBadgeService {
	getUnreadCount(): number {
		return 0;
	}
}
