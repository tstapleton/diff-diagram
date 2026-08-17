import { Injectable } from "@angular/core";

@Injectable({ providedIn: "root" })
export class ThemeService {
	private theme: "light" | "dark" = "dark";

	set(theme: "light" | "dark"): void {
		this.theme = theme;
	}

	get(): "light" | "dark" {
		return this.theme;
	}
}
