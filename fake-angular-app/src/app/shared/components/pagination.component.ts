import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";

@Component({
	selector: "app-pagination",
	standalone: true,
	imports: [CommonModule],
	template: `
    <div class="pagination">
      <button (click)="pageChange.emit(page - 1)" [disabled]="page <= 1">Prev</button>
      <span>{{ page }} / {{ totalPages }}</span>
      <button (click)="pageChange.emit(page + 1)" [disabled]="page >= totalPages">Next</button>
    </div>
  `,
})
export class PaginationComponent {
	@Input() page = 1;
	@Input() totalPages = 1;
	@Output() pageChange = new EventEmitter<number>();
}
