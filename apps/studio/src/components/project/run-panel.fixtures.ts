/**
 * A stand-in `EventSource` for the run panel's tests. jsdom has none.
 *
 * It records every instance, so a test can reach the one the panel opened and drive it: deliver
 * named events with ids, as the relay sends them, or fail the connection.
 */
export class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    super();
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  /** Deliver one event. `id` empty means an id-less frame, like the studio's own notice. */
  emit(kind: string, payload: unknown, id: string): void {
    this.readyState = FakeEventSource.OPEN;
    this.dispatchEvent(new MessageEvent(kind, { data: JSON.stringify(payload), lastEventId: id }));
  }

  /** The server refused the stream; the browser will not reconnect. */
  fail(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.(new Event('error'));
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  static latest(): FakeEventSource {
    const source = FakeEventSource.instances.at(-1);
    if (!source) throw new Error('the panel opened no EventSource');
    return source;
  }
}
