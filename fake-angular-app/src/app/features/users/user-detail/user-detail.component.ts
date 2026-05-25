import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { UserAvatarComponent } from './user-avatar.component';
import { UserRolesBadgeComponent } from './user-roles-badge.component';
import { UserProfileHeaderComponent } from './user-profile-header.component';
import { UserActivityLogComponent } from './user-activity-log.component';
import { UsersService } from '../data-access/users.service';
import { UserModel } from '../models/user.model';

@Component({
  selector: 'app-user-detail',
  standalone: true,
  imports: [CommonModule, UserAvatarComponent, UserRolesBadgeComponent, UserProfileHeaderComponent, UserActivityLogComponent],
  template: `
    <div *ngIf="user" class="user-detail">
      <app-user-profile-header [user]="user" />
      <app-user-roles-badge [roles]="[]" />
      <app-user-activity-log [userId]="user.id" />
    </div>
  `,
})
export class UserDetailComponent implements OnInit {
  user: UserModel | null = null;

  constructor(private route: ActivatedRoute, private usersService: UsersService) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.usersService.getById(id).subscribe(u => (this.user = u));
  }
}
