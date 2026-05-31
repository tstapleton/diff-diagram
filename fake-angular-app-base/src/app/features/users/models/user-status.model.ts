export type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending';

export interface UserStatusModel {
  id: string;
  status: UserStatus;
  label: string;
  color: string;
}
