import type { UserModel } from "../models/user.model";

export interface ValidationError {
	field: keyof UserModel;
	message: string;
}

export function validateUser(partial: Partial<UserModel>): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!partial.email?.includes("@"))
		errors.push({ field: "email", message: "Invalid email" });
	if (!partial.firstName?.trim())
		errors.push({ field: "firstName", message: "Required" });
	if (!partial.lastName?.trim())
		errors.push({ field: "lastName", message: "Required" });
	return errors;
}
