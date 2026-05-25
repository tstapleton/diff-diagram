import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UsersService } from '../data-access/users.service';
import { AuthService } from '../../../shared/services/auth.service';

@Component({
  selector: 'app-user-security',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="user-security">
      <p>Logged in as: {{ currentUser?.email }}</p>
      <button (click)="logout()">Log out</button>
    </div>
  `,
})
export class UserSecurityComponent {
  @Input() userId = '';

  constructor(private usersService: UsersService, private auth: AuthService) {}

  get currentUser() { return this.auth.getUser(); }

  logout(): void {
    this.auth.logout().subscribe();
  }
}
