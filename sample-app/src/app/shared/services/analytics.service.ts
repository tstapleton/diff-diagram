import { Injectable } from "@angular/core";

export interface AnalyticsEvent {
	name: string;
	properties?: Record<string, unknown>;
}

@Injectable({ providedIn: "root" })
export class AnalyticsService {
	track(event: AnalyticsEvent): void {
		console.debug("[Analytics]", event.name, event.properties);
	}

	page(name: string): void {
		this.track({ name: "page_view", properties: { page: name } });
	}
}
