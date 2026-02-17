import React, { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Mic, Square, Play, Trash2, Download, Volume2 } from 'lucide-react';
import { toast } from 'sonner';

interface VoiceMemoProps {
  onTranscription: (text: string, timestamp: number) => void;
}

export function VoiceMemo({ onTranscription }: VoiceMemoProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null);
  const [audioURL, setAudioURL] = useState<string>('');
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      setDuration(0);

      mediaRecorder.ondataavailable = (event) => {
        chunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setRecordedAudio(blob);
        setAudioURL(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
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
      toast.error('Failed to access microphone');
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

    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append('file', recordedAudio, 'voice-memo.webm');

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const apiUrl = import.meta.env.VITE_FRONTEND_FORGE_API_URL || 'https://api.manus.im';
          const apiKey = import.meta.env.VITE_FRONTEND_FORGE_API_KEY;

          if (!apiKey) {
            toast.error('Transcription API not configured');
            return;
          }

          const response = await fetch(`${apiUrl}/audio/transcribe`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
            body: formData,
          });

          if (!response.ok) {
            throw new Error('Transcription failed');
          }

          const data = await response.json();
          const transcribedText = data.text || '';
          const timestamp = Date.now();

          const timestampStr = new Date(timestamp).toLocaleTimeString();
          const formattedText = `[${timestampStr}] ${transcribedText}`;

          onTranscription(formattedText, timestamp);
          toast.success('Transcription completed');

          setRecordedAudio(null);
          setAudioURL('');
          setDuration(0);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Transcription failed');
        } finally {
          setIsTranscribing(false);
        }
      };
      reader.readAsArrayBuffer(recordedAudio);
    } catch (error) {
      toast.error('Failed to transcribe audio');
      setIsTranscribing(false);
    }
  }, [recordedAudio, onTranscription]);

  const handleDownload = useCallback(() => {
    if (audioURL) {
      const a = document.createElement('a');
      a.href = audioURL;
      a.download = `voice-memo-${Date.now()}.webm`;
      a.click();
    }
  }, [audioURL]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <h3 className="font-semibold text-foreground flex items-center gap-2">
        <Volume2 className="w-5 h-5 text-accent" />
        Voice Memo
      </h3>

      {!recordedAudio ? (
        <div className="space-y-3">
          {isRecording && (
            <div className="text-sm text-muted-foreground text-center py-2 bg-muted/20 rounded-lg">
              <div className="flex items-center justify-center gap-2 mb-1">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span>Recording</span>
              </div>
              <span className="font-mono text-accent">{formatDuration(duration)}</span>
            </div>
          )}
          <Button
            onClick={isRecording ? stopRecording : startRecording}
            className={`w-full ${isRecording ? 'btn-notion' : 'btn-notion'}`}
            variant={isRecording ? 'destructive' : 'default'}
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
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground text-center py-2 bg-muted/20 rounded-lg">
            <div className="font-mono text-accent font-semibold">{formatDuration(duration)}</div>
          </div>
          {audioURL && (
            <audio src={audioURL} controls className="w-full rounded-lg bg-muted/20" />
          )}
          <div className="flex gap-2">
            <Button
              onClick={handleTranscribe}
              disabled={isTranscribing}
              className="flex-1 btn-notion"
            >
              {isTranscribing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Transcribing...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Transcribe
                </>
              )}
            </Button>
            <Button
              onClick={handleDownload}
              size="sm"
              className="btn-notion-secondary"
              title="Download audio"
            >
              <Download className="w-4 h-4" />
            </Button>
            <Button
              onClick={() => {
                setRecordedAudio(null);
                setAudioURL('');
                setDuration(0);
              }}
              size="sm"
              className="btn-notion-secondary"
              title="Delete recording"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
