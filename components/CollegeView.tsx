import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { AnyMemory, VoiceMemory, DocumentMemory } from '../types';
import {
  generateSummaryForContent,
  extractTextFromImage,
  generateTitleForContent,
  generateSpeechFromText,
} from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import Recorder from './Recorder';
import QASession from './QASession';
import TemporaryScanView from './TemporaryScanView';
import {
  FolderIcon,
  MicIcon,
  PlusCircleIcon,
  ArrowLeftIcon,
  BrainCircuitIcon,
  BookOpenIcon,
  TrashIcon,
  FileTextIcon,
  CameraIcon,
  UploadIcon,
  Volume2Icon,
  Loader2Icon,
} from './Icons';
import { getCurrentLocation } from '../utils/location';

interface CollegeViewProps {
  lectures: AnyMemory[];
  onSave: (memory: Omit<AnyMemory, 'id' | 'date' | 'category'>) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<AnyMemory>) => void;
  bulkDelete: (ids: string[]) => void;
  courses: string[];
  addCourse: (courseName: string) => void;
}

const LectureDetailView: React.FC<{
  lecture: VoiceMemory;
  onBack: () => void;
  onUpdate: (id: string, updates: Partial<AnyMemory>) => void;
}> = ({ lecture, onBack, onUpdate }) => {
  const [editingSpeakerId, setEditingSpeakerId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const handleEditSpeakerName = (speakerId: number, currentName: string) => {
    setEditingSpeakerId(speakerId);
    setEditText(currentName);
  };

  const handleSaveSpeakerName = () => {
    if (
      editingSpeakerId === null ||
      !lecture.structuredTranscript ||
      !lecture.speakerMappings
    )
      return;

    const newName = editText.trim();
    if (!newName) {
      // Don't save empty names
      setEditingSpeakerId(null);
      return;
    }

    const newMappings = {
      ...lecture.speakerMappings,
      [editingSpeakerId]: newName,
    };

    const newTranscript = lecture.structuredTranscript
      .map((segment, index) => {
        const speakerLabel =
          newMappings[segment.speakerId] || `Speaker ${segment.speakerId}`;
        const prevSegment =
          index > 0 ? lecture.structuredTranscript[index - 1] : null;

        if (!prevSegment || segment.speakerId !== prevSegment.speakerId) {
          return `${index > 0 ? '\n\n' : ''}${speakerLabel}: ${segment.text}`;
        }
        return segment.text;
      })
      .join('');

    onUpdate(lecture.id, {
      speakerMappings: newMappings,
      transcript: newTranscript,
    });

    setEditingSpeakerId(null);
    setEditText('');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center mb-4">
        <button
          onClick={onBack}
          className="p-2 mr-2 rounded-full hover:bg-gray-700"
        >
          <ArrowLeftIcon className="w-6 h-6" />
        </button>
        <h1 className="text-3xl font-bold">{lecture.title}</h1>
      </div>
      <div className="flex-grow overflow-y-auto space-y-6">
        <section>
          <h2 className="text-2xl font-bold text-gray-300 mb-2">Summary</h2>
          <div className="text-lg text-gray-400">
            {lecture.summary
              ? lecture.summary
              : 'Summary is being generated...'}
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-gray-300 mb-2">
            Full Transcript
          </h2>
          {lecture.structuredTranscript && lecture.speakerMappings ? (
            <div className="space-y-4">
              {lecture.structuredTranscript.map((segment, index) => {
                const speakerLabel =
                  lecture.speakerMappings?.[segment.speakerId] ||
                  `Speaker ${segment.speakerId}`;
                const isEditingCurrent =
                  editingSpeakerId === segment.speakerId;

                return (
                  <div key={index} className="flex gap-2">
                    {isEditingCurrent ? (
                      <input
                        type="text"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onBlur={handleSaveSpeakerName}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter')
                            handleSaveSpeakerName();
                          if (e.key === 'Escape')
                            setEditingSpeakerId(null);
                        }}
                        className="bg-gray-700 text-white p-1 rounded-md w-full sm:w-auto focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        autoFocus
                      />
                    ) : (
                      <button
                        onClick={() =>
                          handleEditSpeakerName(segment.speakerId, speakerLabel)
                        }
                        className="text-left sm:text-right hover:text-blue-300 w-full text-blue-400 font-bold px-1"
                        aria-label={`Edit name for ${speakerLabel}`}
                      >
                        {speakerLabel}:
                      </button>
                    )}
                    <span className="flex-1 text-gray-300">
                      {segment.text}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-gray-400">{lecture.transcript}</div>
          )}
        </section>

        <section className="pt-4">
          <h2 className="text-2xl font-bold text-gray-300 mb-4">
            Ask about this lecture:
          </h2>
          <QASession memories={[lecture]} />
        </section>
      </div>
    </div>
  );
};

const DocumentDetailView: React.FC<{
  doc: DocumentMemory;
  onBack: () => void;
}> = ({ doc, onBack }) => {
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSource​Node | null>(null);

  useEffect(() => {
    audioContextRef.current = new (window.AudioContext ||
      (window as any).webkitAudioContext)({ sampleRate: 24000 });
    return () => {
      audioSourceRef.current?.stop();
      audioContextRef.current?.close();
    };
  }, []);

  const handleReadAloud = async () => {
    if (isLoadingAudio || isPlaying) return;

    setIsLoadingAudio(true);
    try {
      const audioB64 = await generateSpeechFromText(doc.extractedText);
      if (audioB64 && audioContextRef.current) {
        const audioData = decode(audioB64);
        const audioBuffer = await decodeAudioData(
          audioData,
          audioContextRef.current,
          24000,
          1
        );

        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        source.onended = () => setIsPlaying(false);
        source.start(0);
        audioSourceRef.current = source;
        setIsPlaying(true);
      }
    } catch (error) {
      console.error('Failed to play audio', error);
    } finally {
      setIsLoadingAudio(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center mb-4">
        <button
          onClick={onBack}
          className="p-2 mr-2 rounded-full hover:bg-gray-700"
        >
          <ArrowLeftIcon className="w-6 h-6" />
        </button>
        <h1 className="text-3xl font-bold">{doc.title}</h1>
        <span className="ml-auto text-gray-400">Scanned document</span>
      </div>

      <div className="flex-grow overflow-y-auto space-y-6">
        <section>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-2xl font-bold text-gray-300">
              Extracted Text
            </h2>
            <button
              onClick={handleReadAloud}
              disabled={isLoadingAudio}
              className="ml-auto flex items-center gap-2 px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-500 transition-colors"
            >
              {isLoadingAudio ? (
                <Loader2Icon className="animate-spin w-5 h-5" />
              ) : (
                <Volume2Icon className="w-5 h-5" />
              )}
              {isLoadingAudio ? 'Generating...' : isPlaying ? 'Playing...' : 'Read Aloud'}
            </button>
          </div>
          <p className="text-gray-300 whitespace-pre-wrap">
            {doc.extractedText}
          </p>
        </section>

        <section className="pt-4">
          <h2 className="text-2xl font-bold text-gray-300 mb-4">
            Ask about this document:
          </h2>
          <QASession memories={[doc]} />
        </section>
      </div>
    </div>
  );
};

const AddDocumentView: React.FC<{
  course: string;
  onSave: (memory: Omit<AnyMemory, 'id' | 'date' | 'category'>) => void;
  onCancel: () => void;
}> = ({ course, onSave, onCancel }) => {
  const [title, setTitle] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [isLoading, setIsLoading] = useState<'camera' | 'ocr' | 'title' | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }, [stream]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const startCamera = async () => {
    stopCamera();
    setImageDataUrl(null);
    setError(null);
    setIsLoading('camera');

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      setStream(mediaStream);
    } catch (err) {
      setError('Could not access camera. Please check permissions.');
    } finally {
      setIsLoading(null);
    }
  };

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const takePicture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
      const dataUrl = canvas.toDataURL('image/jpeg');
      setImageDataUrl(dataUrl);
      stopCamera();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setImageDataUrl(e.target?.result as string);
        stopCamera();
      };
      reader.readAsDataURL(file);
    } else {
      setError('Please select a valid image file.');
    }
  };

  const handleExtractText = async () => {
    if (!imageDataUrl) return;

    setIsLoading('ocr');
    setError(null);

    try {
      const base64Data = imageDataUrl.split(',')[1];
      const mimeType = imageDataUrl.match(/data:([^;]+);/)?.[1] || 'image/jpeg';
      const text = await extractTextFromImage(base64Data, mimeType);
      setExtractedText(text);
    } catch (e) {
      setError('Failed to extract text.');
    } finally {
      setIsLoading(null);
    }
  };

  const handleGenerateTitle = async () => {
    if (!extractedText.trim()) return;

    setIsLoading('title');
    setTitle(await generateTitleForContent(extractedText));
    setIsLoading(null);
  };

  const handleSave = async () => {
    if (!imageDataUrl || !title.trim() || !extractedText.trim()) return;

    const location = await getCurrentLocation();

    onSave({
      type: 'document',
      title,
      imageDataUrl,
      extractedText,
      course,
      ...(location && { location }),
    });
  };

  const renderContent = () => {
    if (extractedText) {
      return (
        <div className="space-y-4">
          <textarea
            value={extractedText}
            onChange={(e) => setExtractedText(e.target.value)}
            rows={10}
            className="w-full bg-gray-700 text-white text-lg p-3 rounded-m
