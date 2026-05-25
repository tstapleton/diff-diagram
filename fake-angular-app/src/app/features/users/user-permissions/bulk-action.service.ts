import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { UsersService } from '../data-access/users.service';
import { UserModel } from '../models/user.model';
import { BulkActionModel } from '../models/bulk-action.model';

@Injectable({ providedIn: 'root' })
export class BulkActionService {
  constructor(private usersService: UsersService) {}

  execute(action: BulkActionModel): Observable<UserModel[]> {
    if (action.type === 'delete') {
      return of(action.userIds.map(id => ({ id } as UserModel)));
    }
    return of([]);
  }

  canExecute(action: BulkActionModel, users: UserModel[]): boolean {
    return action.userIds.every(id => users.some(u => u.id === id));
  }
}
