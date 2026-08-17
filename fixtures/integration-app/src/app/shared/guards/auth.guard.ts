import { Injectable } from "@angular/core";
import type { CanActivate, Router } from "@angular/router";
import type { AuthService } from "../services/auth.service";

@Injectable({ providedIn: "root" })
export class AuthGuard implements CanActivate {
	constructor(
		private auth: AuthService,
		private router: Router,
	) {}

	canActivate(): boolean {
		if (this.auth.isAuthenticated()) return true;
		this.router.navigate(["/login"]);
		return false;
	}
}
