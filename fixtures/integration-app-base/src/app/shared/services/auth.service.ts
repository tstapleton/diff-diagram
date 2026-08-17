import { Injectable } from "@angular/core";
import { type Observable, of } from "rxjs";
import type { ApiService } from "../api/api.service";

export interface AuthUser {
	id: string;
	email: string;
	roles: string[];
}

@Injectable({ providedIn: "root" })
export class AuthService {
	private currentUser: AuthUser | null = null;

	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: fixture stub
	constructor(private api: ApiService) {}

	getUser(): AuthUser | null {
		return this.currentUser;
	}

	isAuthenticated(): boolean {
		return this.currentUser !== null;
	}

	logout(): Observable<void> {
		this.currentUser = null;
		return of(undefined);
	}
}
