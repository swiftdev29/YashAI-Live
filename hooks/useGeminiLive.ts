
import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState, GroundingMetadata } from '../types';
import { createPcmBlob, base64ToBytes, decodeAudioData, blobToBase64 } from '../utils/audio-utils';

export const useGeminiLive = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [groundingMetadata, setGroundingMetadata] = useState<GroundingMetadata | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isThinkingMode, setIsThinkingMode] = useState(false);
  
  // Video States
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [videoSource, setVideoSource] = useState<"camera" | "screen" | "none">("none");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  
  // Interaction States
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);

  // Audio Contexts and Nodes
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const volumeGainNodeRef = useRef<GainNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Video References
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // State Refs for Background Logic
  const currentVolumeRef = useRef<number>(0);
  const isVideoActiveRef = useRef<boolean>(false);
  const videoSourceRef = useRef<"camera" | "screen" | "none">("none");
  const activeSessionRef = useRef<any>(null); 
  
  // Sync refs with state
  useEffect(() => {
    isVideoActiveRef.current = isVideoActive;
    videoSourceRef.current = videoSource;
  }, [isVideoActive, videoSource]);

  // Session Management
  const nextStartTimeRef = useRef<number>(0);
  const currentSessionIdRef = useRef<string>('');
  const groundingTimeoutRef = useRef<any>(null);
  
  // VAD & Interruption Refs
  const silenceTimerRef = useRef<any>(null);
  const isUserSpeakingRef = useRef(false);
  const aiSpeakingTimerRef = useRef<any>(null);
  const speechAccumulatorRef = useRef<number>(0);

  // --- Fix: Declare ref for disconnect to resolve circular dependency and "used before declaration" error ---
  const disconnectRef = useRef<() => Promise<void>>(null as any);

  // --- Media Session Helper for Backgrounding ---
  const updateMediaSession = useCallback((state: 'playing' | 'paused' | 'none') => {
    if ('mediaSession' in navigator) {
      if (state === 'none') {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        // Clear stop action handler when session ends
        navigator.mediaSession.setActionHandler('stop', null);
        return;
      }
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'YashAI Voice Session',
        artist: 'Yash AI',
        artwork: [{ src: 'https://raw.githubusercontent.com/swiftdev29/Jee-mains-checker/refs/heads/main/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' }]
      });
      navigator.mediaSession.playbackState = state;
      // --- Fix: Use disconnectRef inside the handler to avoid direct dependency on disconnect variable before its declaration ---
      navigator.mediaSession.setActionHandler('stop', () => {
        if (disconnectRef.current) disconnectRef.current();
      });
    }
  }, []);

  const stopVideo = useCallback(() => {
    setIsVideoActive(false);
    setVideoSource("none");
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
      videoStreamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const disconnect = useCallback(async () => {
    stopVideo();
    updateMediaSession('none');
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    sourcesRef.current.forEach(source => { try { source.stop(); } catch (e) {} });
    sourcesRef.current.clear();
    if (groundingTimeoutRef.current) clearTimeout(groundingTimeoutRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (aiSpeakingTimerRef.current) clearTimeout(aiSpeakingTimerRef.current);
    if (inputAudioContextRef.current) {
      try { await inputAudioContextRef.current.close(); } catch (e) {}
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      try { await outputAudioContextRef.current.close(); } catch (e) {}
      outputAudioContextRef.current = null;
    }
    setConnectionState(ConnectionState.DISCONNECTED);
    nextStartTimeRef.current = 0;
    activeSessionRef.current = null;
    setGroundingMetadata(null);
    setIsMuted(false);
    setIsUserSpeaking(false);
    setIsAiSpeaking(false);
    isUserSpeakingRef.current = false;
    currentVolumeRef.current = 0;
  }, [stopVideo, updateMediaSession]);

  // --- Fix: Keep disconnectRef updated with the current disconnect function ---
  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  const startCamera = useCallback(async (mode: "user" | "environment" = facingMode) => {
    if (videoSourceRef.current === "screen") stopVideo();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: mode, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } } 
      });
      videoStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsVideoActive(true);
      setVideoSource("camera");
    } catch (e) {
      setError("Camera access failed.");
      setIsVideoActive(false);
    }
  }, [facingMode, stopVideo]);

  const startScreenShare = useCallback(async () => {
    if (videoSourceRef.current === "camera") stopVideo();
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { cursor: "always", frameRate: { ideal: 10 } },
        audio: false
      });
      stream.getVideoTracks()[0].onended = () => stopVideo();
      videoStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsVideoActive(true);
      setVideoSource("screen");
    } catch (e) {
      setError("Screen share failed.");
      setIsVideoActive(false);
    }
  }, [stopVideo]);

  const toggleVideo = useCallback(() => {
    videoSource === "camera" ? stopVideo() : startCamera(facingMode);
  }, [videoSource, startCamera, stopVideo, facingMode]);

  const toggleScreenShare = useCallback(() => {
    videoSource === "screen" ? stopVideo() : startScreenShare();
  }, [videoSource, startScreenShare, stopVideo]);

  const toggleThinkingMode = useCallback(() => {
    if (connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR) {
      setIsThinkingMode(prev => !prev);
    }
  }, [connectionState]);

  const switchCamera = useCallback(() => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    if (videoSource === 'camera') startCamera(newMode);
  }, [facingMode, videoSource, startCamera]);

  // --- Optimized Continuous Streaming Loop ---
  useEffect(() => {
    let timerId: any;
    let isMounted = true;

    const streamLoop = async () => {
      if (!isMounted) return;

      const shouldStream = isVideoActiveRef.current && 
                           connectionState === ConnectionState.CONNECTED && 
                           videoRef.current && 
                           activeSessionRef.current;

      if (shouldStream) {
        try {
          const video = videoRef.current;
          if (video && video.videoWidth > 0) {
            if (!videoCanvasRef.current) videoCanvasRef.current = document.createElement('canvas');
            const canvas = videoCanvasRef.current;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            
            if (ctx) {
              const isScreen = videoSourceRef.current === "screen";
              const targetWidth = isScreen ? 480 : 320;
              const scale = targetWidth / video.videoWidth;
              canvas.width = targetWidth;
              canvas.height = video.videoHeight * scale;
              
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const base64Data = canvas.toDataURL('image/jpeg', 0.4);
              const base64Content = base64Data.split(',')[1];

              if (base64Content && activeSessionRef.current) {
                activeSessionRef.current.sendRealtimeInput({
                  media: { mimeType: 'image/jpeg', data: base64Content }
                });
              }
            }
          }
        } catch (e) {
          console.debug("Loop error", e);
        }
      }

      const isScreen = videoSourceRef.current === "screen";
      const isSpeaking = currentVolumeRef.current > 0.012;
      const interval = isSpeaking ? 500 : (isScreen ? 800 : 1200);
      
      timerId = setTimeout(streamLoop, interval);
    };

    if (connectionState === ConnectionState.CONNECTED) {
      streamLoop();
    }

    return () => {
      isMounted = false;
      clearTimeout(timerId);
    };
  }, [connectionState]);

  const toggleMute = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach(track => track.enabled = !track.enabled);
      setIsMuted(prev => !prev);
    }
  }, []);

  const connect = useCallback(async () => {
    const sessionId = Math.random().toString(36).substring(7);
    currentSessionIdRef.current = sessionId;
    try {
      await disconnect();
      setConnectionState(ConnectionState.CONNECTING);
      setError(null);
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const inputCtx = new AudioContextClass({ sampleRate: 16000 });
      const outputCtx = new AudioContextClass({ latencyHint: 'interactive' });
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;
      const inputAnalyser = inputCtx.createAnalyser();
      inputAnalyser.fftSize = 256;
      inputAnalyserRef.current = inputAnalyser;
      const outputAnalyser = outputCtx.createAnalyser();
      outputAnalyser.fftSize = 256;
      outputAnalyserRef.current = outputAnalyser;
      const volumeGainNode = outputCtx.createGain();
      volumeGainNode.gain.value = 1.0; 
      volumeGainNodeRef.current = volumeGainNode;
      volumeGainNode.connect(outputAnalyser);
      outputAnalyser.connect(outputCtx.destination);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      mediaStreamRef.current = stream;
      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const currentDateTime = new Date().toLocaleString();
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
             if (currentSessionIdRef.current !== sessionId) return;
             sessionPromise.then(session => {
                activeSessionRef.current = session;
                setConnectionState(ConnectionState.CONNECTED);
                updateMediaSession('playing');
             });
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(512, 1, 1);
            scriptProcessorRef.current = scriptProcessor;
            scriptProcessor.onaudioprocess = (e) => {
              if (currentSessionIdRef.current !== sessionId) return;
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              currentVolumeRef.current = rms;
              const aiIsTalking = sourcesRef.current.size > 0;
              if (rms > (aiIsTalking ? 0.03 : 0.012)) {
                speechAccumulatorRef.current += 1;
                if (aiIsTalking && speechAccumulatorRef.current > 2) volumeGainNodeRef.current?.gain.setTargetAtTime(0.2, outputCtx.currentTime, 0.05);
                if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
                if (!isUserSpeakingRef.current) { isUserSpeakingRef.current = true; setIsUserSpeaking(true); setIsAiSpeaking(false); }
                if (activeSessionRef.current) try { activeSessionRef.current.sendRealtimeInput({ media: createPcmBlob(inputData) }); } catch (e) {}
              } else {
                speechAccumulatorRef.current = 0;
                if (isUserSpeakingRef.current && !silenceTimerRef.current) {
                  silenceTimerRef.current = setTimeout(() => {
                    isUserSpeakingRef.current = false; setIsUserSpeaking(false); silenceTimerRef.current = null;
                    volumeGainNodeRef.current?.gain.setTargetAtTime(1.0, outputCtx.currentTime, 0.2);
                  }, 500); 
                }
                if (!aiIsTalking && activeSessionRef.current) try { activeSessionRef.current.sendRealtimeInput({ media: createPcmBlob(inputData) }); } catch(e) {}
              }
            };
            source.connect(inputAnalyser);
            inputAnalyser.connect(scriptProcessor);
            const muteNode = inputCtx.createGain();
            muteNode.gain.value = 0;
            scriptProcessor.connect(muteNode);
            muteNode.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
             if (currentSessionIdRef.current !== sessionId) return;
             const interrupted = message.serverContent?.interrupted;
             if (interrupted) {
               sourcesRef.current.forEach(source => { try { source.stop(); } catch (e) {} });
               sourcesRef.current.clear();
               nextStartTimeRef.current = 0;
               setIsAiSpeaking(false);
               volumeGainNodeRef.current?.gain.cancelScheduledValues(outputAudioContextRef.current!.currentTime);
               if (volumeGainNodeRef.current) volumeGainNodeRef.current.gain.value = 1.0;
             }
             const grounding = (message.serverContent?.modelTurn as any)?.groundingMetadata || (message.serverContent as any)?.groundingMetadata;
             if (grounding) {
               if (groundingTimeoutRef.current) clearTimeout(groundingTimeoutRef.current);
               setGroundingMetadata(grounding);
               groundingTimeoutRef.current = setTimeout(() => setGroundingMetadata(null), 6000);
             }
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
               const ctx = outputAudioContextRef.current;
               if (!ctx) return;
               const now = ctx.currentTime;
               nextStartTimeRef.current = Math.max(nextStartTimeRef.current, now);
               const audioBuffer = await decodeAudioData(base64ToBytes(base64Audio), ctx, 24000, 1);
               const source = ctx.createBufferSource();
               source.buffer = audioBuffer;
               source.connect(volumeGainNode);
               source.addEventListener('ended', () => {
                 sourcesRef.current.delete(source);
                 if (sourcesRef.current.size === 0) {
                     if (aiSpeakingTimerRef.current) clearTimeout(aiSpeakingTimerRef.current);
                     aiSpeakingTimerRef.current = setTimeout(() => { if (sourcesRef.current.size === 0) setIsAiSpeaking(false); }, 200);
                 }
               });
               source.start(nextStartTimeRef.current);
               nextStartTimeRef.current += audioBuffer.duration;
               sourcesRef.current.add(source);
               setIsAiSpeaking(true);
            }
          },
          onerror: () => {
            if (currentSessionIdRef.current === sessionId) { setError("Connection Error."); setConnectionState(ConnectionState.ERROR); disconnect(); }
          },
          onclose: () => {
             if (currentSessionIdRef.current === sessionId) { setConnectionState(ConnectionState.DISCONNECTED); disconnect(); }
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Algenib' } } },
          systemInstruction: `Current system time: ${currentDateTime}. You are a friendly, humorous voice assistant called *Yash AI*. Developed by Yash Sinha. You can "see" through camera or screen. If asked about facts, news, or URLs, use Google Search. Observe the user's screen carefully during screen sharing to assist with technical tasks.`,
          thinkingConfig: { thinkingBudget: isThinkingMode ? 16384 : 0 },
          tools: [{ googleSearch: {} }] 
        }
      });
    } catch (err: any) { setError("Failed to initialize."); setConnectionState(ConnectionState.ERROR); disconnect(); }
  }, [disconnect, updateMediaSession, isThinkingMode]);

  useEffect(() => { return () => { disconnect(); }; }, [disconnect]);

  return { connect, disconnect, connectionState, error, groundingMetadata, inputAnalyser: inputAnalyserRef.current, outputAnalyser: outputAnalyserRef.current, isMuted, toggleMute, videoRef, isVideoActive, videoSource, toggleVideo, toggleScreenShare, switchCamera, isUserSpeaking, isAiSpeaking, isThinkingMode, toggleThinkingMode };
};
