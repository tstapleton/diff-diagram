import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { UsersListComponent } from './user-list/users-list.component';
import { UserBulkActionsComponent } from './user-permissions/user-bulk-actions.component';

@Component({
  selector: 'app-users-page',
  standalone: true,
  imports: [CommonModule, RouterOutlet, UsersListComponent, UserBulkActionsComponent],
  template: `
    <div class="users-page">
      <app-users-list />
      <app-user-bulk-actions [selectedIds]="selectedIds" />
      <router-outlet />
    </div>
  `,
})
export class UsersPageComponent {
  selectedIds: string[] = [];
}
