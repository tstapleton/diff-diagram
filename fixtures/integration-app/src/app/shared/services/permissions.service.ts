import { Injectable } from "@angular/core";

export type Permission =
	| "user:read"
	| "user:write"
	| "user:delete"
	| "user:admin";

@Injectable({ providedIn: "root" })
export class PermissionsService {
	private permissions = new Set<Permission>();

	setPermissions(perms: Permission[]): void {
		this.permissions = new Set(perms);
	}

	can(permission: Permission): boolean {
		return this.permissions.has(permission);
	}

	canAny(...permissions: Permission[]): boolean {
		return permissions.some((p) => this.permissions.has(p));
	}
}
