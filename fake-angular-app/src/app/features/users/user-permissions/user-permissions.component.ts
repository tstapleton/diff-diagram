import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PermissionsService } from '../../../shared/services/permissions.service';
import { UserPermissionsModel } from './user-permissions.model';

@Component({
  selector: 'app-user-permissions',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="user-permissions" *ngIf="canAdmin">
      <p>Effective: {{ permissionsData?.effectivePermissions?.join(', ') }}</p>
    </div>
  `,
})
export class UserPermissionsComponent implements OnInit {
  @Input() userId = '';
  permissionsData: UserPermissionsModel | null = null;

  constructor(private permissionsService: PermissionsService) {}

  get canAdmin(): boolean { return this.permissionsService.can('user:admin'); }

  ngOnInit(): void {
    this.permissionsData = { userId: this.userId, grantedPermissions: [], deniedPermissions: [], effectivePermissions: [] };
  }
}
