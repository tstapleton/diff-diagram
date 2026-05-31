import { UserModel } from '../models/user.model';

export function formatUserForApi(user: Partial<UserModel>): Record<string, unknown> {
  return {
    email: user.email?.toLowerCase().trim(),
    first_name: user.firstName?.trim(),
    last_name: user.lastName?.trim(),
    role_ids: user.roleIds ?? [],
    status_id: user.statusId,
  };
}

export function fullName(user: UserModel): string {
  return `${user.firstName} ${user.lastName}`.trim();
}
