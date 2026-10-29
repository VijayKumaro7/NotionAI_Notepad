/**
 * `URL.createObjectURL` keeps its Blob alive until revoked, not until
 * garbage collected. `exportService.ts` and `TwoFactorSettings.tsx` both
 * revoke theirs immediately after one `<a>` click; this component's URL has
 * to survive for playback and download, so it has to be revoked wherever the
 * recording is discarded instead — on delete, on a successful transcription,
 * and on unmount. Before the fix it was created once per recording and never
 * revoked at all: `setAudioURL("")` drops the component's only reference to
 * it but leaves the browser holding the recording in memory regardless.
 *
 * These tests drive the real component, with `MediaRecorder` and
 * `getUserMedia` stubbed (jsdom has neither) and `URL.createObjectURL` /
 * `revokeObjectURL` spied on rather than mocked away, so a fix that revokes
 * the wrong URL or skips a path still fails these.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { VoiceMemo } from "./VoiceMemo";

const transcribeMock = vi.hoisted(() => vi.fn());
const downloadBlobMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: { ai: { transcribe: { mutate: transcribeMock } } },
    }),
  },
}));

vi.mock("@/lib/exportService", () => ({
  downloadBlob: downloadBlobMock,
}));

// Overridden per test to simulate a browser other than the Chrome/Firefox
// default — Safari reports `audio/mp4` here instead of `audio/webm`.
let fakeRecorderMimeType = "audio/webm";

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = fakeRecorderMimeType;

  constructor(private stream: MediaStream) {
    FakeMediaRecorder.instances.push(this);
  }

  start() {}

  stop() {
    this.ondataavailable?.({
      data: new Blob(["chunk"], { type: this.mimeType }),
    });
    this.onstop?.();
  }
}

let createdURLs: string[] = [];
let revokedURLs: string[] = [];
let stopTrack: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  createdURLs = [];
  revokedURLs = [];
  fakeRecorderMimeType = "audio/webm";
  transcribeMock.mockReset();
  downloadBlobMock.mockReset();

  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

  stopTrack = vi.fn();
  const fakeStream = {
    getTracks: () => [{ stop: stopTrack }],
  } as unknown as MediaStream;
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
    configurable: true,
  });

  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:fake-${createdURLs.length}`;
    createdURLs.push(url);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn((url: string) => {
    revokedURLs.push(url);
  }) as typeof URL.revokeObjectURL;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function recordAndStop() {
  render(<VoiceMemo noteId="n" onTranscription={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /stop recording/i })
    ).not.toBeNull()
  );

  fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
  await waitFor(() => expect(createdURLs.length).toBeGreaterThan(0));
}

describe("recording lifecycle", () => {
  it("creates exactly one object URL per recording, for playback", async () => {
    await recordAndStop();

    expect(createdURLs).toHaveLength(1);
    // Throws if the row isn't there — proof enough that a Delete control
    // exists for the recording just made.
    screen.getByRole("button", { name: /delete recording/i });
  });

  it("revokes the recording's URL on delete, not just clears the reference", async () => {
    await recordAndStop();
    expect(revokedURLs).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /delete recording/i }));

    expect(revokedURLs).toEqual(createdURLs);
    // Back to the empty state — nothing left to leak on a second recording.
    screen.getByRole("button", { name: /start recording/i });
  });

  it("revokes the recording's URL after a successful transcription", async () => {
    transcribeMock.mockResolvedValue({ text: "hello" });
    await recordAndStop();

    fireEvent.click(screen.getByRole("button", { name: /^transcribe$/i }));

    await waitFor(() => expect(revokedURLs).toEqual(createdURLs));
  });

  it("revokes the recording's URL on unmount, so leaving the page does not leak it", async () => {
    const { unmount } = render(
      <VoiceMemo noteId="n" onTranscription={vi.fn()} />
    );

    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /stop recording/i })
      ).not.toBeNull()
    );
    fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
    await waitFor(() => expect(createdURLs.length).toBeGreaterThan(0));

    expect(revokedURLs).toHaveLength(0);
    unmount();
    expect(revokedURLs).toEqual(createdURLs);
  });

  it("does not revoke anything when the panel unmounts with no recording made", () => {
    const { unmount } = render(
      <VoiceMemo noteId="n" onTranscription={vi.fn()} />
    );
    unmount();
    expect(revokedURLs).toHaveLength(0);
  });

  it("releases the microphone and never creates a URL when unmounted mid-recording", async () => {
    const { unmount } = render(
      <VoiceMemo noteId="n" onTranscription={vi.fn()} />
    );

    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /stop recording/i })
      ).not.toBeNull()
    );

    // No `.stop()` was ever clicked — the recording is still in progress,
    // with no blob and no URL yet, when the panel goes away (switching
    // notes, signing out).
    expect(createdURLs).toHaveLength(0);
    unmount();

    // `MediaRecorder.stop()` is synchronous in this fake and fires `onstop`
    // immediately, which checks `isMountedRef` before creating anything —
    // so this proves both halves at once: the mic was released, and doing
    // so didn't leak a URL nothing is left to revoke.
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(createdURLs).toHaveLength(0);
    expect(revokedURLs).toHaveLength(0);
  });
});

describe("transcribing a recording", () => {
  it("does not discard a newer recording made while an old transcription was still in flight", async () => {
    // A promise this test controls, so the request can be left pending
    // across a delete and a brand-new recording before it resolves.
    let resolveTranscribe: (value: { text: string }) => void;
    transcribeMock.mockReturnValue(
      new Promise(resolve => {
        resolveTranscribe = resolve;
      })
    );

    await recordAndStop();
    const recordingA = createdURLs[0];

    fireEvent.click(screen.getByRole("button", { name: /^transcribe$/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /stop transcribing/i })
      ).not.toBeNull()
    );

    // Delete and Download sit beside the Transcribe/Stop-transcribing
    // button, not behind it — the panel never disables them while a
    // transcription is in flight, so this is a real, reachable sequence,
    // not a contrived race.
    fireEvent.click(screen.getByRole("button", { name: /delete recording/i }));
    expect(revokedURLs).toEqual([recordingA]);

    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /stop recording/i })
      ).not.toBeNull()
    );
    fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
    await waitFor(() => expect(createdURLs).toHaveLength(2));
    const recordingB = createdURLs[1];

    // The stale request for A finally answers.
    resolveTranscribe!({ text: "transcribed A" });

    // Give the resolved promise's .then chain a turn, the same way the
    // other tests let an async click settle — there is no further UI
    // transition to wait on if the bug is present, since a wrongly cleared
    // B looks identical to a correctly-kept B until the URL log is read.
    await waitFor(() => expect(transcribeMock).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 0));

    // B is what's on screen — only A's URL was ever revoked.
    expect(revokedURLs).toEqual([recordingA]);
    expect(createdURLs[1]).toBe(recordingB);
    screen.getByRole("button", { name: /delete recording/i });
  });
});

describe("downloading a recording", () => {
  it("goes through the shared downloadBlob helper with the recorded blob", async () => {
    await recordAndStop();

    fireEvent.click(screen.getByRole("button", { name: /download audio/i }));

    expect(downloadBlobMock).toHaveBeenCalledTimes(1);
    const [blob, filename] = downloadBlobMock.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(filename).toMatch(/^voice-memo-\d+\.webm$/);
  });

  it("saves under .m4a, not .webm, when the browser recorded audio/mp4", async () => {
    // Safari's MediaRecorder: no webm support, mp4 instead. Before the fix the
    // Blob was always labelled "audio/webm" regardless of what was actually
    // recorded, so this filename stayed .webm even here — a file that opens
    // wrong in whatever the OS hands it to, because it isn't webm inside.
    fakeRecorderMimeType = "audio/mp4";
    await recordAndStop();

    fireEvent.click(screen.getByRole("button", { name: /download audio/i }));

    const [, filename] = downloadBlobMock.mock.calls[0];
    expect(filename).toMatch(/^voice-memo-\d+\.m4a$/);
  });
});

describe("the recorded blob's declared type", () => {
  it("matches what the browser actually encoded, not a hardcoded assumption", async () => {
    fakeRecorderMimeType = "audio/mp4";
    transcribeMock.mockResolvedValue({ text: "hello" });
    await recordAndStop();

    fireEvent.click(screen.getByRole("button", { name: /^transcribe$/i }));

    await waitFor(() => expect(transcribeMock).toHaveBeenCalled());
    const [{ mimeType }] = transcribeMock.mock.calls[0];
    expect(mimeType).toBe("audio/mp4");
  });
});

/**
 * The panel is mounted once and stays up while notes are switched, and a
 * transcription takes seconds. The text has to land in the note the recording
 * was made for: before, it was handed to whichever note was open when the reply
 * arrived, built from the content that note had when Transcribe was clicked.
 */
describe("a transcription that arrives after the note has changed", () => {
  async function startTranscribing(onTranscription: () => void) {
    let resolveTranscribe: (value: { text: string }) => void;
    transcribeMock.mockReturnValue(
      new Promise(resolve => {
        resolveTranscribe = resolve;
      })
    );

    const view = render(
      <VoiceMemo noteId="a" onTranscription={onTranscription} />
    );
    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /stop recording/i })
      ).not.toBeNull()
    );
    fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));
    await waitFor(() => expect(createdURLs.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: /^transcribe$/i }));
    await waitFor(() => expect(transcribeMock).toHaveBeenCalledTimes(1));
    return { view, resolve: (text: string) => resolveTranscribe!({ text }) };
  }

  it("is not inserted into a different note, and the recording is kept", async () => {
    const onTranscription = vi.fn();
    const { view, resolve } = await startTranscribing(onTranscription);

    view.rerender(<VoiceMemo noteId="b" onTranscription={onTranscription} />);
    resolve("spoken words");
    await new Promise(r => setTimeout(r, 0));

    expect(onTranscription).not.toHaveBeenCalled();
    // Kept, so it can be transcribed again where it belongs.
    expect(revokedURLs).toEqual([]);
    screen.getByRole("button", { name: /delete recording/i });
  });

  it("is inserted when the note is still the one it was recorded for", async () => {
    const onTranscription = vi.fn();
    const { view, resolve } = await startTranscribing(onTranscription);

    view.rerender(<VoiceMemo noteId="a" onTranscription={onTranscription} />);
    resolve("spoken words");

    await waitFor(() => expect(onTranscription).toHaveBeenCalledTimes(1));
    expect(onTranscription.mock.calls[0][0]).toContain("spoken words");
  });
});
