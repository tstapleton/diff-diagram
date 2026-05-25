import { Routes } from '@angular/router';
import { UsersPageComponent } from './users-page.component';
import { UsersListComponent } from './user-list/users-list.component';
import { UserDetailComponent } from './user-detail/user-detail.component';
import { UserEditDialogComponent } from './user-edit/user-edit-dialog.component';
import { UserCreateDialogComponent } from './user-edit/user-create-dialog.component';
import { UserSettingsComponent } from './user-settings/user-settings.component';
import { UserPermissionsComponent } from './user-permissions/user-permissions.component';
import { AuthGuard } from '../../shared/guards/auth.guard';
import { RoleGuard } from '../../shared/guards/role.guard';

export const USERS_ROUTES: Routes = [
  {
    path: '',
    component: UsersPageComponent,
    canActivate: [AuthGuard],
    children: [
      { path: '', component: UsersListComponent },
      { path: 'new', component: UserCreateDialogComponent, canActivate: [RoleGuard], data: { permissions: ['user:write'] } },
      { path: ':id', component: UserDetailComponent },
      { path: ':id/edit', component: UserEditDialogComponent, canActivate: [RoleGuard], data: { permissions: ['user:write'] } },
      { path: ':id/settings', component: UserSettingsComponent },
      { path: ':id/permissions', component: UserPermissionsComponent, canActivate: [RoleGuard], data: { permissions: ['user:admin'] } },
    ],
  },
];
