import React, { useState, useRef } from 'react';
import { transcribeAudioFile } from '../services/geminiService';
import { Download, Copy, Check, X, Loader2Icon } from 'lucide-react';

interface TranscriptionResult {
  fileName: string;
  transcript: string;
  timestamp: number;
}

const TranscriptionUploader: React.FC = () => {
  const [transcript, setTranscript] = useState<TranscriptionResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/wav', 'audio/webm'];
    if (!validTypes.some(type => file.type.includes(type.split('/')[1]))) {
      setError('Please select an M4A, MP3, MP4, WAV, or WebM audio file');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProgress(0);

    try {
      const text = await transcribeAudioFile(file, setProgress);

      if (text.includes('Error') || text.includes('error')) {
        setError(text);
      } else {
        setTranscript({
          fileName: file.name,
          transcript: text,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      setError('Failed to transcribe audio. Please try again.');
    } finally {
      setIsProcessing(false);
      setProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCopyToClipboard = () => {
    if (transcript) {
      navigator.clipboard.writeText(transcript.transcript).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const handleDownloadTxt = () => {
    if (transcript) {
      const element = document.createElement('a');
      const file = new Blob([transcript.transcript], { type: 'text/plain' });
      element.href = URL.createObjectURL(file);
      element.download = `${transcript.fileName.replace(/\.[^/.]+$/, '')}_transcript.txt`;
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      URL.revokeObjectURL(element.href);
    }
  };

  const handleClear = () => {
    setTranscript(null);
    setError(null);
  };

  return (
    <div className="w-full max-w-3xl mx-auto p-6">
      <div className="bg-gray-800 rounded-3xl border-4 border-gray-700 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-6 bg-gray-900/50 border-b-4 border-gray-700">
          <h2 className="text-2xl font-black text-white uppercase">Lecture Transcription</h2>
          <p className="text-sm text-gray-400 mt-2">Share M4A or MP4 files from Samsung Notes and get instant transcripts</p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {!transcript ? (
            <>
              {/* Upload Area */}
              <div
                className="border-4 border-dashed border-gray-600 rounded-2xl p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-500/5 transition-all"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/mp4,audio/m4a,audio/mpeg,audio/wav,audio/webm,.m4a,.mp3,.mp4,.wav,.webm"
                  onChange={handleFileSelect}
                  disabled={isProcessing}
                  className="hidden"
                />

                {isProcessing ? (
                  <div className="space-y-4">
                    <Loader2Icon className="w-12 h-12 animate-spin mx-auto text-blue-400" />
                    <p className="text-white font-bold uppercase">Transcribing...</p>
                    <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-blue-600 h-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="text-sm text-gray-400">{progress}%</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-4xl">🎤</p>
                    <p className="text-white font-bold uppercase">Click to upload audio file</p>
                    <p className="text-sm text-gray-400">Supports M4A, MP3, MP4, WAV, WebM (up to 90 minutes)</p>
                  </div>
                )}
              </div>

              {error && (
                <div className="p-4 bg-red-900/30 border-2 border-red-600 rounded-2xl">
                  <p className="text-red-300 font-bold text-sm">{error}</p>
                </div>
              )}

              {/* Info Box */}
              <div className="p-4 bg-gray-900/50 rounded-2xl border-2 border-gray-700 space-y-2">
                <p className="text-xs font-black text-white/60 uppercase">How it works</p>
                <ul className="text-xs text-gray-400 space-y-1">
                  <li>✓ Upload an audio file from your Samsung Notes recording</li>
                  <li>✓ Transcription happens instantly</li>
                  <li>✓ Copy transcript and paste back into Samsung Notes</li>
                  <li>✓ Supports Hebrew and English</li>
                </ul>
              </div>
            </>
          ) : (
            <>
              {/* Transcript Display */}
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg">
                  <p className="text-sm font-bold text-white truncate">{transcript.fileName}</p>
                  <button
                    onClick={handleClear}
                    className="text-gray-400 hover:text-white transition-colors"
                    title="Clear transcript"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="max-h-96 overflow-y-auto p-4 bg-gray-900 rounded-2xl border-2 border-gray-700">
                  <p className="text-white text-sm leading-relaxed whitespace-pre-wrap font-mono">
                    {transcript.transcript}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleCopyToClipboard}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold text-sm uppercase transition-all active:scale-95"
                >
                  {copied ? (
                    <>
                      <Check size={18} />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={18} />
                      Copy to Clipboard
                    </>
                  )}
                </button>

                <button
                  onClick={handleDownloadTxt}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-500 text-white rounded-2xl font-bold text-sm uppercase transition-all active:scale-95"
                >
                  <Download size={18} />
                  Download .txt
                </button>
              </div>

              {/* New Upload Button */}
              <button
                onClick={() => {
                  handleClear();
                  fileInputRef.current?.click();
                }}
                className="w-full px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-2xl font-bold text-sm uppercase transition-all active:scale-95"
              >
                Transcribe Another File
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TranscriptionUploader;
