import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Mic, Square, Play, Trash2, Download, Volume2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { createInFlight } from "@/lib/inFlight";
import { downloadBlob } from "@/lib/exportService";
import { toast } from "sonner";

interface VoiceMemoProps {
  /**
   * The note the recording belongs to. The panel is mounted once and stays up
   * while notes are switched, and a transcription takes seconds, so this is how
   * it knows whether the note it was started for is still the one on screen.
   */
  noteId: string;
  onTranscription: (text: string, timestamp: number) => void;
}

/**
 * The file extension a recording's actual MIME type implies.
 *
 * Chrome and Firefox record `audio/webm`; Safari does not support that
 * container at all and records `audio/mp4` instead. A download extension
 * that disagrees with the bytes inside it opens wrong in whatever the OS
 * hands it to next, so this reads the type rather than assuming one.
 */
function fileExtension(mimeType: string): string {
  const subtype = mimeType.split(";")[0].split("/")[1];
  if (subtype === "mp4") return "m4a";
  return subtype || "webm";
}

/**
 * Base64 for the recording, via a data: URL.
 *
 * Deliberately not `btoa(String.fromCharCode(...bytes))`: spreading a typed
 * array of any real length throws RangeError once the argument list gets big,
 * and a voice memo is megabytes. FileReader does the encoding itself.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the recording"));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      if (comma === -1) {
        reject(new Error("Could not read the recording"));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export function VoiceMemo({ noteId, onTranscription }: VoiceMemoProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null);
  const [audioURL, setAudioURL] = useState<string>("");
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  // Mirrors audioURL so the unmount cleanup below can reach the current
  // value without depending on it — a dependency here would re-run the
  // effect, and revoke-then-immediately-recreate, on every recording. Also
  // what `handleTranscribe` checks before clearing: identity, not content,
  // since two different recordings can legitimately produce the same text.
  const audioURLRef = useRef<string>("");
  // The note on screen *now*, which `handleTranscribe` compares with the note it
  // was started for: its own `noteId` is the value from the render it began in.
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  // False once the component has started unmounting. `onstop` is async and
  // can still fire afterward — without this it would create a blob URL
  // nothing is left to revoke, the same leak the unmount cleanup exists to
  // close, just arriving from the other direction.
  const isMountedRef = useRef(true);

  // The vanilla client rather than the mutation hook: cancelling needs an
  // AbortSignal per request, and the hook builds its own call with nowhere to
  // put one. Same reason as the chat box.
  const utils = trpc.useUtils();
  const inFlight = useMemo(createInFlight, []);

  /**
   * A blob: URL keeps its Blob alive in the browser until revoked, not until
   * garbage collected — `setAudioURL("")` drops the only reference this
   * component held but leaves the underlying recording pinned in memory for
   * the rest of the page's life. `exportService.ts` and
   * `TwoFactorSettings.tsx` revoke theirs immediately because the URL only
   * exists to drive one `<a>` click; this one has to survive for playback
   * and download, so it is revoked here instead, wherever the recording is
   * discarded.
   */
  const clearRecording = useCallback(() => {
    if (audioURLRef.current) URL.revokeObjectURL(audioURLRef.current);
    setRecordedAudio(null);
    setAudioURL("");
    setDuration(0);
  }, []);

  useEffect(() => {
    audioURLRef.current = audioURL;
  }, [audioURL]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (audioURLRef.current) URL.revokeObjectURL(audioURLRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      // Stops the microphone too, via `onstop`'s own `track.stop()` below —
      // otherwise a recording in progress when the panel unmounts (switching
      // notes, signing out) never releases it: nothing else was going to
      // call `.stop()` for it. `onstop` checks `isMountedRef` before
      // touching state or creating a URL, so this can't resurrect either.
      if (mediaRecorderRef.current?.state !== "inactive") {
        mediaRecorderRef.current?.stop();
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      setDuration(0);

      mediaRecorder.ondataavailable = event => {
        chunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        // Unconditional: releasing the mic does not depend on whether
        // anything is still around to show the recording.
        stream.getTracks().forEach(track => track.stop());

        // `.stop()` can be called by the unmount cleanup below, and this
        // fires after that effect has already run — nothing is left to
        // revoke a URL created here, so don't create one.
        if (!isMountedRef.current) return;

        // `mediaRecorder.mimeType` is what the browser actually encoded, not
        // an assumption — Safari reports `audio/mp4` here, and a Blob labelled
        // `audio/webm` over those bytes fails to play back and transcribes
        // under the wrong format.
        const blob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType || "audio/webm",
        });
        setRecordedAudio(blob);
        setAudioURL(URL.createObjectURL(blob));
      };

      mediaRecorder.start();
      setIsRecording(true);

      // Timer
      let seconds = 0;
      timerRef.current = setInterval(() => {
        seconds++;
        setDuration(seconds);
      }, 1000);
    } catch (error) {
      toast.error("Failed to access microphone");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  }, [isRecording]);

  const handleTranscribe = useCallback(async () => {
    if (!recordedAudio) return;

    // Identifies *this* recording, not just this request. `inFlight.owns`
    // below only tells a superseded transcribe attempt from the current
    // one — it says nothing about whether the person deleted this
    // recording and made a new one while the old request was still in
    // flight, which `inFlight` has no reason to know about.
    const transcribingURL = audioURLRef.current;
    const transcribingNoteId = noteId;

    // Outside the try, so the catch and finally can ask whether the attempt
    // they are cleaning up after is still the current one.
    const attempt = inFlight.start();
    setIsTranscribing(true);

    try {
      const audioBase64 = await blobToBase64(recordedAudio);
      // MediaRecorder reports e.g. `audio/webm;codecs=opus`; the codecs
      // parameter means nothing to the transcriber and only has to survive
      // being put in a data: URL, so it is dropped here.
      const mimeType = (recordedAudio.type || "audio/webm").split(";")[0];

      const { text } = await utils.client.ai.transcribe.mutate(
        { audioBase64, mimeType },
        { signal: attempt.signal }
      );

      // Only the transcription still being waited on may write to the note.
      // Aborting does not recall a reply already on its way, so a stop is what
      // makes this false — otherwise the text lands in the note of someone who
      // cancelled, and clears the recording they asked to keep.
      if (!inFlight.owns(attempt)) return;

      // The text belongs to the note the recording was made for. If another
      // note is open now, putting it there is writing into the wrong document,
      // so it is not added anywhere and the recording stays, to be transcribed
      // again from the right note.
      if (noteIdRef.current !== transcribingNoteId) {
        toast.error(
          "That recording was made in another note, so it was not added here. Switch back to it to add the transcription."
        );
        return;
      }

      const timestamp = Date.now();
      const timestampStr = new Date(timestamp).toLocaleTimeString();
      onTranscription(`[${timestampStr}] ${text}`, timestamp);
      toast.success("Transcription completed");

      // Only clear the recording this request actually transcribed. If the
      // person deleted it and recorded something new while this was in
      // flight, `audioURLRef.current` now names that new recording instead —
      // clearing unconditionally here would revoke and discard it in place
      // of a transcription it has nothing to do with.
      if (audioURLRef.current === transcribingURL) {
        clearRecording();
      }
    } catch (error) {
      // This attempt's own signal, not whatever is current: a stop is
      // announced where it was asked for, so there is nothing to say here.
      if (attempt.signal.aborted) return;

      // And nothing to say either for an attempt the panel has moved on from.
      if (inFlight.owns(attempt)) {
        toast.error(
          error instanceof Error ? error.message : "Transcription failed"
        );
      }
    } finally {
      // Only the attempt still being waited on: one finishing late must not
      // switch off the button belonging to the one that replaced it.
      if (inFlight.settle(attempt)) setIsTranscribing(false);
    }
  }, [recordedAudio, noteId, onTranscription, utils, inFlight, clearRecording]);

  /**
   * Stop a transcription in flight.
   *
   * Whisper is charged by the length of the recording, so this is the request
   * where stopping saves the most — the server passes the same abort on to the
   * provider rather than only closing the browser's end.
   */
  const stopTranscribing = useCallback(() => {
    // Letting go, not only aborting: the reply may already be on its way, and
    // an attempt the panel still holds is one it would use when it lands.
    if (!inFlight.abandon()) return;
    setIsTranscribing(false);
    // Said here rather than left to the catch, which never runs when the
    // reply wins the race. Stopping keeps the recording: someone who cancels
    // a transcription wants the audio back, not a cleared panel.
    toast("Transcription stopped. The recording is still here.");
  }, [inFlight]);

  const handleDownload = useCallback(() => {
    if (!recordedAudio) return;
    // Goes through the shared helper rather than building its own anchor:
    // that version skips `document.body.appendChild`, which is a no-op in
    // some browsers on a detached element (see TwoFactorSettings.tsx).
    const extension = fileExtension(recordedAudio.type || "audio/webm");
    downloadBlob(recordedAudio, `voice-memo-${Date.now()}.${extension}`);
  }, [recordedAudio]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
        <Volume2 className="w-5 h-5 text-accent" />
        Voice Memo
      </h3>

      {!recordedAudio ? (
        <div className="space-y-3">
          {isRecording && (
            <div className="text-sm text-muted-foreground text-center py-2 bg-muted/20 rounded-lg">
              <div className="flex items-center justify-center gap-2 mb-1">
                <div className="w-2 h-2 bg-destructive rounded-full animate-pulse" />
                <span>Recording</span>
              </div>
              <span className="font-mono text-accent">
                {formatDuration(duration)}
              </span>
            </div>
          )}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`w-full ${isRecording ? "btn-notion-destructive" : "btn-notion"}`}
          >
            {isRecording ? (
              <>
                <Square className="w-4 h-4 mr-2" />
                Stop Recording
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 mr-2" />
                Start Recording
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground text-center py-2 bg-muted/20 rounded-lg">
            <div className="font-mono text-accent font-semibold">
              {formatDuration(duration)}
            </div>
          </div>
          {audioURL && (
            <audio
              src={audioURL}
              controls
              className="w-full rounded-lg bg-muted/20"
            />
          )}
          <div className="flex gap-2">
            {isTranscribing ? (
              // Replaces the button rather than sitting beside it: a disabled
              // "Transcribing…" with a Stop next to it is two controls for one
              // decision.
              <button
                onClick={stopTranscribing}
                className="flex-1 btn-notion-secondary"
              >
                <Square className="w-3 h-3 mr-2" />
                Stop transcribing
              </button>
            ) : (
              <button onClick={handleTranscribe} className="flex-1 btn-notion">
                <Play className="w-4 h-4 mr-2" />
                Transcribe
              </button>
            )}
            <button
              onClick={handleDownload}
              className="btn-notion-secondary btn-notion-sm"
              title="Download audio"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={clearRecording}
              className="btn-notion-secondary btn-notion-sm"
              title="Delete recording"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
