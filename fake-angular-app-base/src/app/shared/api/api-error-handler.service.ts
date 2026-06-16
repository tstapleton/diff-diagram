import type { HttpErrorResponse } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { type Observable, throwError } from "rxjs";

@Injectable({ providedIn: "root" })
export class ApiErrorHandlerService {
	handle(error: HttpErrorResponse): Observable<never> {
		const message = error.error?.message ?? `HTTP ${error.status}`;
		console.error("[ApiError]", message);
		return throwError(() => new Error(message));
	}
}
