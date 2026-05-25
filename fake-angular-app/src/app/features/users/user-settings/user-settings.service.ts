import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { UserPreferencesModel } from './user-preferences.model';
import { ApiService } from '../../../shared/api/api.service';

@Injectable({ providedIn: 'root' })
export class UserSettingsService {
  constructor(private api: ApiService) {}

  getSettings(userId: string): Observable<UserPreferencesModel> {
    return this.api.get<UserPreferencesModel>(`/api/users/${userId}/settings`);
  }

  updateSettings(userId: string, settings: Partial<UserPreferencesModel>): Observable<UserPreferencesModel> {
    return this.api.put<UserPreferencesModel>(`/api/users/${userId}/settings`, settings);
  }
}
