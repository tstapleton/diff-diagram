import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UserAuditService } from './user-audit.service';
import { AuditEventModel } from './audit-event.model';

@Component({
  selector: 'app-user-activity-log',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ul class="activity-log">
      <li *ngFor="let event of events">{{ event.action }} — {{ event.performedAt }}</li>
    </ul>
  `,
})
export class UserActivityLogComponent implements OnInit {
  @Input() userId = '';
  events: AuditEventModel[] = [];

  constructor(private auditService: UserAuditService) {}

  ngOnInit(): void {
    this.auditService.getEvents({ id: this.userId } as never).subscribe(e => (this.events = e));
  }
}
