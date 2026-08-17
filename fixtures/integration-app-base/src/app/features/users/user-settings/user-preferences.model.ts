export interface UserPreferencesModel {
	userId: string;
	theme: "light" | "dark" | "system";
	language: string;
	timezone: string;
	emailNotifications: boolean;
	pushNotifications: boolean;
}
