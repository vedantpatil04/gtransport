/**
 * A scriptable XMLHttpRequest for the upload tests. Each `send()` plays the next scripted outcome,
 * and every request is recorded so tests can assert what really went over the wire.
 */
export type ScriptedOutcome =
  | { status: number; body?: unknown; rawBody?: string }
  | { error: 'network' }
  | { error: 'timeout' }
  | { error: 'abort' };

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  timeout: number;
  form: { _parts: [string, unknown][] };
}

export class FakeXhr {
  static script: ScriptedOutcome[] = [];
  static requests: RecordedRequest[] = [];
  static progress: [number, number][] = [
    [200, 1000],
    [1000, 1000],
  ];

  static reset(script: ScriptedOutcome[] = []): void {
    FakeXhr.script = [...script];
    FakeXhr.requests = [];
    FakeXhr.progress = [
      [200, 1000],
      [1000, 1000],
    ];
  }

  static install(): void {
    const globals = global as unknown as { XMLHttpRequest: unknown; FormData: unknown };
    globals.XMLHttpRequest = FakeXhr;
    // On the device FormData is React Native's, which keeps a { uri, name, type } file part as is
    // (Node's, which jest provides, would turn it into the string "[object Object]").
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reactNativeFormData = require('react-native/Libraries/Network/FormData');
    globals.FormData = reactNativeFormData.default ?? reactNativeFormData;
  }

  status = 0;
  responseText = '';
  timeout = 0;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  private method = '';
  private url = '';
  private headers: Record<string, string> = {};

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(form: { _parts: [string, unknown][] }): void {
    FakeXhr.requests.push({ method: this.method, url: this.url, headers: this.headers, timeout: this.timeout, form });
    const outcome = FakeXhr.script.shift() ?? { status: 500, body: { error: { message: 'script exhausted' } } };
    setTimeout(() => {
      if ('error' in outcome) {
        if (outcome.error === 'network') this.onerror?.();
        else if (outcome.error === 'timeout') this.ontimeout?.();
        else this.onabort?.();
        return;
      }
      for (const [loaded, total] of FakeXhr.progress) this.upload.onprogress?.({ lengthComputable: true, loaded, total });
      this.status = outcome.status;
      this.responseText = outcome.rawBody ?? (outcome.body === undefined ? '' : JSON.stringify(outcome.body));
      this.onload?.();
    }, 0);
  }
}
