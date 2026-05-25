import { Pipe, PipeTransform } from '@angular/core';
import { UserModel } from '../models/user.model';

@Pipe({ name: 'userDisplayName', standalone: true })
export class UserDisplayNamePipe implements PipeTransform {
  transform(user: UserModel): string {
    return `${user.firstName} ${user.lastName}`.trim() || user.email;
  }
}
