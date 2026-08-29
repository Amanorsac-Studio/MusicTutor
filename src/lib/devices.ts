/**
 * Device discovery.
 *
 * The guiding rule: every subsystem fails independently. Media enumeration,
 * MIDI, and permission prompts each get their own error boundary, so a declined
 * MIDI prompt can never blank the camera and microphone lists — which is
 * exactly the failure that made every control in this app look disabled.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { midiManager, type MidiPort } from './midi';

export type DeviceOption = { id: string; name: string; groupId?: string };

export type DeviceCatalog = {
  audioInputs: DeviceOption[];
  audioOutputs: DeviceOption[];
  videoInputs: DeviceOption[];
  midiInputs: MidiPort[];
  midiOutputs: MidiPort[];
  /** True once device labels are readable, which requires granted permission. */
  labelsVisible: boolean;
  media: SubsystemStatus;
  midi: SubsystemStatus;
  loading: boolean;
};

export type SubsystemStatus = {
  state: 'idle' | 'loading' | 'ready' | 'denied' | 'unsupported' | 'error';
  message?: string;
};

export const EMPTY_CATALOG: DeviceCatalog = {
  audioInputs: [],
  audioOutputs: [],
  videoInputs: [],
  midiInputs: [],
  midiOutputs: [],
  labelsVisible: false,
  media: { state: 'idle' },
  midi: { state: 'idle' },
  loading: false,
};

const fallbackName = (kind: string, index: number): string => {
  if (kind === 'audioinput') return `Microphone ${index}`;
  if (kind === 'audiooutput') return `Speaker ${index}`;
  return `Camera ${index}`;
};

/**
 * Enumerate media devices. Returns partial data plus a status rather than
 * throwing, so callers can always render something useful.
 */
export async function enumerateMedia(): Promise<{
  audioInputs: DeviceOption[];
  audioOutputs: DeviceOption[];
  videoInputs: DeviceOption[];
  labelsVisible: boolean;
  status: SubsystemStatus;
}> {
  const empty = { audioInputs: [], audioOutputs: [], videoInputs: [], labelsVisible: false };
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return { ...empty, status: { state: 'unsupported', message: 'Media devices are not available in this environment.' } };
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const counters: Record<string, number> = {};
    const pick = (kind: MediaDeviceKind): DeviceOption[] =>
      devices
        .filter(device => device.kind === kind)
        .map(device => {
          counters[kind] = (counters[kind] ?? 0) + 1;
          return {
            id: device.deviceId,
            name: device.label || fallbackName(kind, counters[kind]),
            groupId: device.groupId,
          };
        });

    const audioInputs = pick('audioinput');
    const audioOutputs = pick('audiooutput');
    const videoInputs = pick('videoinput');
    const labelsVisible = devices.some(device => Boolean(device.label));

    return {
      audioInputs,
      audioOutputs,
      videoInputs,
      labelsVisible,
      status: {
        state: 'ready',
        message: labelsVisible ? undefined : 'Connect devices to see their names.',
      },
    };
  } catch (error) {
    return {
      ...empty,
      status: { state: 'error', message: error instanceof Error ? error.message : 'Could not list devices.' },
    };
  }
}

/**
 * Ask for capture permission so that `enumerateDevices` returns real labels.
 * Falls back to audio-only when there is no camera, and reports the outcome
 * instead of throwing.
 */
export async function requestMediaPermission(): Promise<SubsystemStatus> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { state: 'unsupported', message: 'Capture is not available in this environment.' };
  }
  const attempts: MediaStreamConstraints[] = [
    { audio: true, video: true },
    { audio: true, video: false },
    { audio: false, video: true },
  ];
  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach(track => track.stop());
      return { state: 'ready' };
    } catch (error) {
      lastError = error;
      // NotAllowedError means the user said no — trying a narrower request
      // would only prompt them again, so stop here.
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        return {
          state: 'denied',
          message: 'Camera or microphone access was blocked. Allow access in Windows privacy settings, then reconnect.',
        };
      }
    }
  }
  return {
    state: 'error',
    message: lastError instanceof Error ? lastError.message : 'No capture device could be opened.',
  };
}

/**
 * Shared device catalog. Media and MIDI refresh independently and a failure in
 * either leaves the other intact.
 */
export function useDeviceCatalog() {
  const [catalog, setCatalog] = useState<DeviceCatalog>(EMPTY_CATALOG);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refreshMedia = useCallback(async (requestPermission = false) => {
    if (!mounted.current) return;
    setCatalog(current => ({ ...current, loading: true }));

    let permission: SubsystemStatus | undefined;
    if (requestPermission) permission = await requestMediaPermission();

    const media = await enumerateMedia();
    if (!mounted.current) return;

    setCatalog(current => ({
      ...current,
      audioInputs: media.audioInputs,
      audioOutputs: media.audioOutputs,
      videoInputs: media.videoInputs,
      labelsVisible: media.labelsVisible,
      // A denied permission is the more informative message to surface.
      media: permission && permission.state !== 'ready' ? permission : media.status,
      loading: false,
    }));
  }, []);

  const refreshMidi = useCallback(async () => {
    if (!mounted.current) return;
    const status = await midiManager.connect();
    if (!mounted.current) return;
    setCatalog(current => ({
      ...current,
      midiInputs: status.inputs,
      midiOutputs: status.outputs,
      midi: !status.supported
        ? { state: 'unsupported', message: status.reason }
        : status.granted
          ? { state: 'ready', message: status.inputs.length ? undefined : 'No MIDI devices detected.' }
          : { state: 'denied', message: status.reason },
    }));
  }, []);

  /** Refresh both subsystems. Each is awaited separately so neither can abort the other. */
  const refresh = useCallback(async (requestPermission = false) => {
    await Promise.allSettled([refreshMedia(requestPermission), refreshMidi()]);
  }, [refreshMedia, refreshMidi]);

  useEffect(() => {
    void refresh(false);

    const onDeviceChange = () => { void refreshMedia(false); };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);

    const unsubscribe = midiManager.onStatusChange(status => {
      if (!mounted.current) return;
      setCatalog(current => ({ ...current, midiInputs: status.inputs, midiOutputs: status.outputs }));
    });

    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
      unsubscribe();
    };
  }, [refresh, refreshMedia]);

  return { catalog, refresh, refreshMedia, refreshMidi };
}
