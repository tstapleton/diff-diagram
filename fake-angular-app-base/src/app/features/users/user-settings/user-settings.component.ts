import { CommonModule } from "@angular/common";
import { Component, Input, type OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { UserPreferencesModel } from "./user-preferences.model";
import type { UserPreferencesService } from "./user-preferences.service";

@Component({
	selector: "app-user-settings",
	standalone: true,
	imports: [CommonModule, FormsModule],
	template: `
    <div *ngIf="prefs" class="user-settings">
      <label>Theme
        <select [(ngModel)]="prefs.theme" (ngModelChange)="save()">
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </label>
    </div>
  `,
})
export class UserSettingsComponent implements OnInit {
	@Input() userId = "";
	prefs: UserPreferencesModel | null = null;

	constructor(private prefsService: UserPreferencesService) {}

	ngOnInit(): void {
		this.prefsService.get(this.userId).subscribe((p) => (this.prefs = p));
	}

	save(): void {
		if (this.prefs) this.prefsService.save(this.prefs).subscribe();
	}
}
