export interface SecuritySession {
	userId: string;
	lastLoginAt: string;
	mfaEnabled: boolean;
}
