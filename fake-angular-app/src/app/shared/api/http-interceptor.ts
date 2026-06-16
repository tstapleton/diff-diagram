import type {
	HttpEvent,
	HttpHandler,
	HttpInterceptor,
	HttpRequest,
} from "@angular/common/http";
import { Injectable } from "@angular/core";
import type { Observable } from "rxjs";

@Injectable()
export class AuthHttpInterceptor implements HttpInterceptor {
	intercept(
		req: HttpRequest<unknown>,
		next: HttpHandler,
	): Observable<HttpEvent<unknown>> {
		const token = localStorage.getItem("auth_token");
		if (token) {
			const cloned = req.clone({
				headers: req.headers.set("Authorization", `Bearer ${token}`),
			});
			return next.handle(cloned);
		}
		return next.handle(req);
	}
}
