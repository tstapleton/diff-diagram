import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-avatar',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="avatar" [style.background-image]="'url(' + src + ')'">{{ initials }}</div>`,
})
export class AvatarComponent {
  @Input() src = '';
  @Input() initials = '';
}
