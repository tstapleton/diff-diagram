import { Injectable } from "@angular/core";

@Injectable({ providedIn: "root" })
export class HttpClientService {
	get(path: string): Promise<unknown> {
		return fetch(path).then((r) => r.json());
	}
}
