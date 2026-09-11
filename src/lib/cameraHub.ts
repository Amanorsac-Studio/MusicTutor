/**
 * Shared camera streams.
 *
 * A device can only be opened once, so every part of the app that wants to show
 * a camera asks the hub for it instead of calling getUserMedia itself. The hub
 * keeps one stream and one hidden <video> element per device and hands the same
 * element to every caller.
 *
 * This is what connects the two pages: a camera added on Devices is opened
 * here, so a camera source in the Tutorial scene displays it immediately, and
 * the recording compositor draws from the very same element.
 */

export type CameraState = {
  deviceId: string;
  label: string;
  active: boolean;
  error?: string;
  width: number;
  height: number;
};

type Entry = {
  deviceId: string;
  label: string;
  stream?: MediaStream;
  element: HTMLVideoElement;
  /** How many callers currently want this camera open. */
  refs: number;
  error?: string;
  opening?: Promise<void>;
};

class CameraHub {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    this.listeners.forEach(listener => {
      try { listener(); } catch { /* a bad listener must not break capture */ }
    });
  }

  private entryFor(deviceId: string, label = ''): Entry {
    let entry = this.entries.get(deviceId);
    if (!entry) {
      const element = document.createElement('video');
      element.muted = true;
      element.playsInline = true;
      element.autoplay = true;
      // Kept out of the layout; it exists purely as a frame source.
      element.style.position = 'fixed';
      element.style.width = '1px';
      element.style.height = '1px';
      element.style.opacity = '0';
      element.style.pointerEvents = 'none';
      element.style.left = '-10px';
      document.body.appendChild(element);
      entry = { deviceId, label, element, refs: 0 };
      this.entries.set(deviceId, entry);
    }
    if (label) entry.label = label;
    return entry;
  }

  /**
   * Open a camera (or join one already open) and return its video element.
   * Never throws: on failure the entry records the reason and the element
   * simply has no frames.
   */
  async acquire(deviceId: string, label = ''): Promise<HTMLVideoElement> {
    const entry = this.entryFor(deviceId, label);
    entry.refs += 1;

    if (entry.stream || entry.opening) {
      await entry.opening?.catch(() => {});
      return entry.element;
    }

    entry.opening = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        entry.stream = stream;
        entry.error = undefined;
        entry.element.srcObject = stream;
        await entry.element.play().catch(() => { /* autoplay retries on user gesture */ });
      } catch (error) {
        entry.error = error instanceof Error ? error.message : 'Camera unavailable';
      } finally {
        entry.opening = undefined;
        this.notify();
      }
    })();

    await entry.opening;
    return entry.element;
  }

  /** Give up one reference. The device is closed once nobody wants it. */
  release(deviceId: string): void {
    const entry = this.entries.get(deviceId);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs > 0) return;
    entry.stream?.getTracks().forEach(track => track.stop());
    entry.stream = undefined;
    entry.element.srcObject = null;
    this.notify();
  }

  /** The element for a camera, if it is open. */
  element(deviceId: string): HTMLVideoElement | undefined {
    const entry = this.entries.get(deviceId);
    return entry?.stream ? entry.element : undefined;
  }

  /**
   * The live stream for a camera. Several <video> elements can share one
   * MediaStream, so views attach this directly rather than copying nodes.
   */
  stream(deviceId: string): MediaStream | undefined {
    return this.entries.get(deviceId)?.stream;
  }

  isActive(deviceId: string): boolean {
    return Boolean(this.entries.get(deviceId)?.stream);
  }

  errorFor(deviceId: string): string | undefined {
    return this.entries.get(deviceId)?.error;
  }

  /** Every camera the hub knows about, for listing in the UI. */
  list(): CameraState[] {
    return [...this.entries.values()].map(entry => ({
      deviceId: entry.deviceId,
      label: entry.label || 'Camera',
      active: Boolean(entry.stream),
      error: entry.error,
      width: entry.element.videoWidth,
      height: entry.element.videoHeight,
    }));
  }

  /** Apply a resolution/frame-rate change to a live camera. */
  async applyFormat(deviceId: string, width: number, height: number, frameRate: number): Promise<string | undefined> {
    const track = this.entries.get(deviceId)?.stream?.getVideoTracks()[0];
    if (!track) return 'Camera is not open';
    try {
      await track.applyConstraints({
        width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate },
      });
      this.notify();
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : 'Format not supported';
    }
  }

  /** Close everything. Used when the app shuts down. */
  releaseAll(): void {
    this.entries.forEach(entry => {
      entry.stream?.getTracks().forEach(track => track.stop());
      entry.stream = undefined;
      entry.refs = 0;
      entry.element.srcObject = null;
    });
    this.notify();
  }
}

export const cameraHub = new CameraHub();
