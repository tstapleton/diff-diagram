import { Injectable } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
import { UserModel } from '../models/user.model';
import { UsersService } from './users.service';
import { CacheService } from '../../../shared/services/cache.service';

@Injectable({ providedIn: 'root' })
export class UsersCacheService {
  private readonly KEY = 'users_all';

  constructor(private usersService: UsersService, private cache: CacheService) {}

  getAll(): Observable<UserModel[]> {
    const cached = this.cache.get<UserModel[]>(this.KEY);
    if (cached) return of(cached);
    return this.usersService.getAll().pipe(tap(users => this.cache.set(this.KEY, users)));
  }

  invalidate(): void {
    this.cache.invalidate(this.KEY);
  }
}
