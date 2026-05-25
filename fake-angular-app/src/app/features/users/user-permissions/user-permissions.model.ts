export interface UserPermissionsModel {
  userId: string;
  grantedPermissions: string[];
  deniedPermissions: string[];
  effectivePermissions: string[];
}
