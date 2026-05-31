import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { UserPreferencesModel } from './user-preferences.model';
import { StorageService } from '../../../shared/services/storage.service';

@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private readonly KEY = 'user_preferences';

  constructor(private storage: StorageService) {}

  get(userId: string): Observable<UserPreferencesModel | null> {
    return of(this.storage.get<UserPreferencesModel>(`${this.KEY}_${userId}`));
  }

  save(prefs: UserPreferencesModel): Observable<void> {
    this.storage.set(`${this.KEY}_${prefs.userId}`, prefs);
    return of(undefined);
  }
}
