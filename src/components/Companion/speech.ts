/** Thin wrapper over the Web Speech API (webkitSpeechRecognition). No TTS. */

interface Rec {
  lang: string; interimResults: boolean; continuous: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type RecCtor = new () => Rec;

export function getRecognitionCtor(): RecCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface SpeechHandlers {
  onInterim: (t: string) => void;
  onFinal: (t: string) => void;
  onState: (listening: boolean) => void;
  onError: (message: string) => void;
}

export interface SpeechController { supported: boolean; start: () => void; stop: () => void; active: () => boolean }

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone is blocked in this browser. Type instead.',
  'service-not-allowed': 'Microphone is blocked in this browser. Type instead.',
  'no-speech': "I didn't catch that. Try again.",
  'audio-capture': 'No microphone found. Type instead.',
  network: 'Voice needs a connection. Type instead.',
};

export function createSpeech(h: SpeechHandlers): SpeechController {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return { supported: false, start: () => h.onError('Voice is not supported in this browser. Type instead.'), stop: () => {}, active: () => false };
  let rec: Rec | null = null;
  let finalText = '';
  return {
    supported: true,
    active: () => rec !== null,
    start() {
      if (rec) return;
      const r = new Ctor();
      r.lang = 'en-US'; r.interimResults = true; r.continuous = false;
      finalText = '';
      r.onresult = (e) => {
        let fin = '', interim = '';
        for (let i = 0; i < e.results.length; i++) {
          const alt = e.results[i][0]?.transcript ?? '';
          if (e.results[i].isFinal) fin += alt; else interim += alt;
        }
        finalText = fin;
        h.onInterim((fin + interim).trim());
      };
      r.onerror = (e) => { if (e.error !== 'aborted') h.onError(ERRORS[e.error] ?? 'Voice stopped. Type instead.'); };
      r.onend = () => {
        rec = null; h.onState(false);
        const t = finalText.trim(); finalText = '';
        if (t) h.onFinal(t);
      };
      rec = r;
      try { r.start(); h.onState(true); h.onError(''); } catch { rec = null; h.onState(false); }
    },
    stop() { try { rec?.stop(); } catch { /* already stopped */ } },
  };
}
