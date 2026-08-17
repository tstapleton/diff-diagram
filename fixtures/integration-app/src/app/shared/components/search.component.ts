import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";

@Component({
	selector: "app-search",
	standalone: true,
	imports: [CommonModule, FormsModule],
	template: `<input type="search" [(ngModel)]="query" (ngModelChange)="queryChange.emit($event)" [placeholder]="placeholder" />`,
})
export class SearchComponent {
	@Input() placeholder = "Search…";
	@Input() query = "";
	@Output() queryChange = new EventEmitter<string>();
}
