import { Injectable } from "@angular/core";
import { type Observable, of } from "rxjs";
import type { AnalyticsService } from "../../../shared/services/analytics.service";
import type { UserModel } from "../models/user.model";
import type { AuditEventModel } from "./audit-event.model";

@Injectable({ providedIn: "root" })
export class UserAuditService {
	constructor(private analytics: AnalyticsService) {}

	getEvents(user: UserModel): Observable<AuditEventModel[]> {
		this.analytics.track({
			name: "user_audit_viewed",
			properties: { userId: user.id },
		});
		return of([]);
	}
}
