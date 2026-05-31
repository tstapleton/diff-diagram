import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { UserModel } from '../models/user.model';
import { AuditEventModel } from './audit-event.model';
import { AnalyticsService } from '../../../shared/services/analytics.service';

@Injectable({ providedIn: 'root' })
export class UserAuditService {
  constructor(private analytics: AnalyticsService) {}

  getEvents(user: UserModel): Observable<AuditEventModel[]> {
    this.analytics.track({ name: 'user_audit_viewed', properties: { userId: user.id } });
    return of([]);
  }
}
