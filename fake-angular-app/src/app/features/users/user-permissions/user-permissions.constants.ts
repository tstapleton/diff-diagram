export const USER_PERMISSIONS = {
	READ: "user:read",
	WRITE: "user:write",
	DELETE: "user:delete",
	ADMIN: "user:admin",
	EXPORT: "user:export",
	BULK: "user:bulk",
} as const;

export type UserPermission =
	(typeof USER_PERMISSIONS)[keyof typeof USER_PERMISSIONS];
