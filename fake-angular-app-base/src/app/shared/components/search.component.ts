import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `<input type="search" [(ngModel)]="query" (ngModelChange)="queryChange.emit($event)" [placeholder]="placeholder" />`,
})
export class SearchComponent {
  @Input() placeholder = 'Search…';
  @Input() query = '';
  @Output() queryChange = new EventEmitter<string>();
}
