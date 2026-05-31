import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { PermissionsService } from '../services/permissions.service';

@Injectable({ providedIn: 'root' })
export class RoleGuard implements CanActivate {
  constructor(private permissions: PermissionsService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): boolean {
    const required = route.data['permissions'] as string[] | undefined;
    if (!required?.length) return true;
    const allowed = required.some(p => this.permissions.can(p as never));
    if (!allowed) this.router.navigate(['/forbidden']);
    return allowed;
  }
}
