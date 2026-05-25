import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CsvService {
  toBlob<T extends object>(rows: T[], headers?: string[]): Blob {
    const keys = headers ?? (rows[0] ? Object.keys(rows[0]) : []);
    const lines = [keys.join(','), ...rows.map(r => keys.map(k => JSON.stringify((r as Record<string, unknown>)[k] ?? '')).join(','))];
    return new Blob([lines.join('\n')], { type: 'text/csv' });
  }

  download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
