import { Pipe, PipeTransform } from '@angular/core';
import { RoleModel } from '../models/role.model';

@Pipe({ name: 'userRole', standalone: true })
export class UserRolePipe implements PipeTransform {
  transform(roleId: string, roles: RoleModel[]): string {
    return roles.find(r => r.id === roleId)?.name ?? roleId;
  }
}
