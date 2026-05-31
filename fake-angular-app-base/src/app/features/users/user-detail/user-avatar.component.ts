import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-user-avatar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="user-avatar" [style.background-image]="src ? 'url(' + src + ')' : 'none'">
      <span *ngIf="!src">{{ initials }}</span>
    </div>
  `,
})
export class UserAvatarComponent {
  @Input() src = '';
  @Input() initials = '';
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
}
