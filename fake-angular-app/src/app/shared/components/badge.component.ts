import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-badge',
  standalone: true,
  imports: [CommonModule],
  template: `<span class="badge badge--{{ variant }}">{{ label }}</span>`,
})
export class BadgeComponent {
  @Input() label = '';
  @Input() variant: 'default' | 'success' | 'warning' | 'danger' = 'default';
}
