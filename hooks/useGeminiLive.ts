
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
  
  // Background Persistence Heartbeat
  const heartbeatNodeRef = useRef<OscillatorNode | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Refs for logic consistency
  const currentVolumeRef = useRef<number>(0);
  const isVideoActiveRef = useRef<boolean>(false);
  const videoSourceRef = useRef<"camera" | "screen" | "none">("none");
  const activeSessionRef = useRef<any>(null); 
  const currentSessionIdRef = useRef<string>('');
  
  // References for cleanup
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sync refs with state
  useEffect(() => {
    isVideoActiveRef.current = isVideoActive;
    videoSourceRef.current = videoSource;
  }, [isVideoActive, videoSource]);

  // VAD & Interruption
  const silenceTimerRef = useRef<any>(null);
  const isUserSpeakingRef = useRef(false);
  const aiSpeakingTimerRef = useRef<any>(null);
  const speechAccumulatorRef = useRef<number>(0);
  const nextStartTimeRef = useRef<number>(0);
  const groundingTimeoutRef = useRef<any>(null);

  // --- Background Persistence: Heartbeat ---
  // This generates a silent signal to keep the audio process alive in background
  const startHeartbeat = useCallback((ctx: AudioContext) => {
    if (heartbeatNodeRef.current) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001; // Silent but non-zero
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      heartbeatNodeRef.current = osc;
    } catch (e) {
      console.warn("Heartbeat failed", e);
    }
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatNodeRef.current) {
      try {
        heartbeatNodeRef.current.stop();
        heartbeatNodeRef.current.disconnect();
      } catch (e) {}
      heartbeatNodeRef.current = null;
    }
  }, []);

  // --- Wake Lock Management ---
  const requestWakeLock = useCallback(async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (err) {}
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().then(() => { wakeLockRef.current = null; });
    }
  }, []);

  // --- Visibility & Persistence Logic ---
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && connectionState === ConnectionState.CONNECTED) {
        await requestWakeLock();
        if (inputAudioContextRef.current?.state === 'suspended') await inputAudioContextRef.current.resume();
        if (outputAudioContextRef.current?.state === 'suspended') await outputAudioContextRef.current.resume();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [connectionState, requestWakeLock]);

  const disconnectRef = useRef<() => Promise<void>>(null as any);

  const updateMediaSession = useCallback((state: 'playing' | 'paused' | 'none') => {
    if ('mediaSession' in navigator) {
      if (state === 'none') {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        return;
      }
      // Fix Error on line 128: Removed unsupported 'subtitle' property from MediaMetadata initialization.
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'YashAI Voice Session',
        artist: 'Yash AI Assistant',
        artwork: [{ src: 'https://raw.githubusercontent.com/swiftdev29/Jee-mains-checker/refs/heads/main/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' }]
      });
      navigator.mediaSession.playbackState = state;
      navigator.mediaSession.setActionHandler('stop', () => disconnectRef.current?.());
      navigator.mediaSession.setActionHandler('pause', () => { navigator.mediaSession.playbackState = 'paused'; });
      navigator.mediaSession.setActionHandler('play', () => { navigator.mediaSession.playbackState = 'playing'; });
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
    releaseWakeLock();
    stopHeartbeat();
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
    if (inputAudioContextRef.current) {
      try { await inputAudioContextRef.current.close(); } catch (e) {}
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      try { await outputAudioContextRef.current.close(); } catch (e) {}
      outputAudioContextRef.current = null;
    }
    setConnectionState(ConnectionState.DISCONNECTED);
    activeSessionRef.current = null;
    setIsUserSpeaking(false);
    setIsAiSpeaking(false);
    currentVolumeRef.current = 0;
  }, [stopVideo, updateMediaSession, releaseWakeLock, stopHeartbeat]);

  useEffect(() => { disconnectRef.current = disconnect; }, [disconnect]);

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

      // Prevent background suspension by maintaining an active audio graph
      startHeartbeat(outputCtx);

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

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      mediaStreamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const currentDateTime = new Date().toLocaleString();
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
             if (currentSessionIdRef.current !== sessionId) return;
             sessionPromise.then(async (session) => {
                activeSessionRef.current = session;
                setConnectionState(ConnectionState.CONNECTED);
                await requestWakeLock();
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

              if (rms > (sourcesRef.current.size > 0 ? 0.03 : 0.012)) {
                if (activeSessionRef.current) activeSessionRef.current.sendRealtimeInput({ media: createPcmBlob(inputData) });
                if (!isUserSpeakingRef.current) { isUserSpeakingRef.current = true; setIsUserSpeaking(true); setIsAiSpeaking(false); }
              } else {
                if (isUserSpeakingRef.current) {
                  setTimeout(() => { 
                    if (currentVolumeRef.current < 0.012) { isUserSpeakingRef.current = false; setIsUserSpeaking(false); }
                  }, 500);
                }
                if (sourcesRef.current.size === 0 && activeSessionRef.current) activeSessionRef.current.sendRealtimeInput({ media: createPcmBlob(inputData) });
              }
            };
            source.connect(inputAnalyser);
            inputAnalyser.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
             if (currentSessionIdRef.current !== sessionId) return;
             const interrupted = message.serverContent?.interrupted;
             if (interrupted) {
               sourcesRef.current.forEach(source => { try { source.stop(); } catch (e) {} });
               sourcesRef.current.clear();
               nextStartTimeRef.current = 0;
               setIsAiSpeaking(false);
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
                 if (sourcesRef.current.size === 0) setIsAiSpeaking(false);
               });
               source.start(nextStartTimeRef.current);
               nextStartTimeRef.current += audioBuffer.duration;
               sourcesRef.current.add(source);
               setIsAiSpeaking(true);
             }
             const grounding = (message.serverContent?.modelTurn as any)?.groundingMetadata;
             if (grounding) setGroundingMetadata(grounding);
          },
          onerror: () => { if (currentSessionIdRef.current === sessionId) { setError("Connection Lost."); disconnect(); } },
          onclose: () => { if (currentSessionIdRef.current === sessionId) { disconnect(); } }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Algenib' } } },
          systemInstruction: `System time: ${currentDateTime}. You are Yash AI, a friendly assistant. You can see via camera/screen. You must remain active even in background.`,
          thinkingConfig: { thinkingBudget: isThinkingMode ? 16384 : 0 },
          tools: [{ googleSearch: {} }] 
        }
      });
    } catch (err: any) { setError("Failed to initialize."); disconnect(); }
  }, [disconnect, updateMediaSession, isThinkingMode, requestWakeLock, startHeartbeat]);

  const startCamera = useCallback(async (mode: "user" | "environment" = facingMode) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: 640 } });
      videoStreamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setIsVideoActive(true);
      setVideoSource("camera");
    } catch (e) { setError("Camera access failed."); }
  }, [facingMode]);

  const toggleVideo = useCallback(() => { videoSource === "camera" ? stopVideo() : startCamera(facingMode); }, [videoSource, startCamera, stopVideo, facingMode]);

  // Fix Error in App.tsx: Implemented toggleScreenShare to allow screen sharing functionality.
  const toggleScreenShare = useCallback(async () => {
    if (videoSource === "screen") {
      stopVideo();
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        videoStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setIsVideoActive(true);
        setVideoSource("screen");
        // Ensure cleanup if user stops sharing via browser bar
        stream.getVideoTracks()[0].onended = () => stopVideo();
      } catch (e) {
        setError("Screen share failed.");
      }
    }
  }, [videoSource, stopVideo]);

  // Fix Error in App.tsx: Implemented switchCamera to allow toggling between front and back cameras.
  const switchCamera = useCallback(async () => {
    const newMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(newMode);
    if (videoSource === "camera") {
      await startCamera(newMode);
    }
  }, [facingMode, videoSource, startCamera]);

  const toggleThinkingMode = useCallback(() => { if (connectionState === ConnectionState.DISCONNECTED) setIsThinkingMode(p => !p); }, [connectionState]);
  const toggleMute = useCallback(() => { if (mediaStreamRef.current) { mediaStreamRef.current.getAudioTracks().forEach(t => t.enabled = !t.enabled); setIsMuted(p => !p); } }, []);

  // Video Streaming Loop
  useEffect(() => {
    let timer: any;
    const loop = () => {
      if (isVideoActiveRef.current && connectionState === ConnectionState.CONNECTED && activeSessionRef.current && videoRef.current) {
         if (!videoCanvasRef.current) videoCanvasRef.current = document.createElement('canvas');
         const canvas = videoCanvasRef.current;
         canvas.width = 320;
         canvas.height = 240;
         const ctx = canvas.getContext('2d');
         if (ctx) {
           ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
           const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
           activeSessionRef.current.sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: base64 } });
         }
      }
      timer = setTimeout(loop, 1000);
    };
    loop();
    return () => clearTimeout(timer);
  }, [connectionState]);

  // Fix Errors in App.tsx: Added missing toggleScreenShare and switchCamera to the hook's return value.
  return { 
    connect, 
    disconnect, 
    connectionState, 
    error, 
    groundingMetadata, 
    inputAnalyser: inputAnalyserRef.current, 
    outputAnalyser: outputAnalyserRef.current, 
    isMuted, 
    toggleMute, 
    videoRef, 
    isVideoActive, 
    videoSource, 
    toggleVideo, 
    toggleScreenShare, 
    switchCamera, 
    isUserSpeaking, 
    isAiSpeaking, 
    isThinkingMode, 
    toggleThinkingMode 
  };
};
