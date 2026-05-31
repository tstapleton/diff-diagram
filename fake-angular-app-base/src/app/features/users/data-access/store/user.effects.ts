import { Injectable } from '@angular/core';
import { UserAction, loadUsersSuccess, loadUsersFailure } from './user.actions';
import { UsersService } from '../users.service';

@Injectable()
export class UserEffects {
  constructor(private usersService: UsersService) {}

  handleLoadUsers(): void {
    this.usersService.getAll().subscribe({
      next: users => this.dispatch(loadUsersSuccess(users)),
      error: (err: Error) => this.dispatch(loadUsersFailure(err)),
    });
  }

  private dispatch(action: UserAction): void {
    console.debug('[UserEffects]', action.type);
  }
}
