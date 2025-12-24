
import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState, GroundingMetadata } from '../types';
import { createPcmBlob, base64ToBytes, decodeAudioData } from '../utils/audio-utils';

export const useGeminiLive = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [groundingMetadata, setGroundingMetadata] = useState<GroundingMetadata | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isThinkingMode, setIsThinkingMode] = useState(false);
  
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [videoSource, setVideoSource] = useState<"camera" | "screen" | "none">("none");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);

  // Audio Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const volumeGainNodeRef = useRef<GainNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Session Refs
  const activeSessionRef = useRef<any>(null); 
  const currentSessionIdRef = useRef<string>('');
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  // Vision Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastSendTimeRef = useRef<number>(0);

  const isUserSpeakingRef = useRef<boolean>(false);
  const nextStartTimeRef = useRef<number>(0);

  /**
   * Clears the playback queue when the server confirms an interrupt.
   */
  const stopAllAiAudio = useCallback(() => {
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsAiSpeaking(false);
  }, []);

  const disconnect = useCallback(async () => {
    setIsVideoActive(false);
    setVideoSource("none");
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
      videoStreamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    stopAllAiAudio();
    
    if (inputAudioContextRef.current) { try { await inputAudioContextRef.current.close(); } catch(e){} inputAudioContextRef.current = null; }
    if (outputAudioContextRef.current) { try { await outputAudioContextRef.current.close(); } catch(e){} outputAudioContextRef.current = null; }

    setConnectionState(ConnectionState.DISCONNECTED);
    activeSessionRef.current = null;
    sessionPromiseRef.current = null;
    setIsUserSpeaking(false);
  }, [stopAllAiAudio]);

  /**
   * Optimized Frame Capture:
   * 320px width and 0.3 quality are MANDATORY to prevent the 15s lag.
   * This resolution is still perfect for Gemini 2.5 Flash to recognize objects.
   */
  const captureAndSendFrame = useCallback(() => {
    const video = videoRef.current;
    const session = activeSessionRef.current;
    if (!isVideoActive || !video || video.readyState < 2 || !session) return;

    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
    }
    const canvas = offscreenCanvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    
    if (ctx) {
      const targetWidth = 320; 
      const ratio = video.videoHeight / video.videoWidth;
      const targetHeight = Math.floor(targetWidth * ratio);

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

      // Low quality (0.3) ensures the frame is sent instantly over WebSocket
      const base64 = canvas.toDataURL('image/jpeg', 0.3).split(',')[1];
      session.sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: base64 } });
      lastSendTimeRef.current = performance.now();
    }
  }, [isVideoActive]);

  const connect = useCallback(async () => {
    const sessionId = Math.random().toString(36).substring(7);
    currentSessionIdRef.current = sessionId;
    try {
      setConnectionState(ConnectionState.CONNECTING);
      setError(null);

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const inputCtx = new AudioContextClass({ sampleRate: 16000 });
      const outputCtx = new AudioContextClass({ latencyHint: 'interactive' });
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      const inputAnalyser = inputCtx.createAnalyser();
      inputAnalyserRef.current = inputAnalyser;
      const outputAnalyser = outputCtx.createAnalyser();
      outputAnalyserRef.current = outputAnalyser;

      const volumeGainNode = outputCtx.createGain();
      volumeGainNodeRef.current = volumeGainNode;
      volumeGainNode.connect(outputAnalyser);
      outputAnalyser.connect(outputCtx.destination);

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
      });
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
             });

            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(1024, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              if (currentSessionIdRef.current !== sessionId) return;
              const inputData = e.inputBuffer.getChannelData(0);
              
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);

              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
              
              if (rms > 0.012) {
                // IMMEDIATELY lower volume (ducking) when user is detected
                if (volumeGainNodeRef.current) {
                    volumeGainNodeRef.current.gain.setTargetAtTime(0.05, outputCtx.currentTime, 0.05);
                }

                if (!isUserSpeakingRef.current) { 
                  isUserSpeakingRef.current = true; 
                  setIsUserSpeaking(true); 
                  
                  // SYNCED VISION: Capture frame exactly when you start asking the question
                  captureAndSendFrame();
                }
              } else {
                if (isUserSpeakingRef.current) {
                  isUserSpeakingRef.current = false;
                  setIsUserSpeaking(false);
                  // Restore volume when user stops talking
                  if (volumeGainNodeRef.current) {
                    volumeGainNodeRef.current.gain.setTargetAtTime(1.0, outputCtx.currentTime, 0.1);
                  }
                }
              }
            };
            source.connect(inputAnalyser);
            inputAnalyser.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
             if (currentSessionIdRef.current !== sessionId) return;
             
             // Server confirms turn is over / interrupted
             if (message.serverContent?.interrupted) {
               stopAllAiAudio();
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
             
             // Check all possible locations for grounding metadata
             const grounding = (message as any)?.groundingMetadata || 
                               (message.serverContent as any)?.groundingMetadata || 
                               (message.serverContent?.modelTurn as any)?.groundingMetadata;

             if (grounding) setGroundingMetadata(grounding);
          },
          onerror: (e) => { setError("Connection Dropped"); disconnect(); },
          onclose: () => disconnect()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Algenib' } } },
          realtimeInputConfig: {
            automaticActivityDetection: {
              silenceDurationMs: 200
          }},
          systemInstruction: `Current system time: ${currentDateTime}. You are a friendly, humorous voice assistant called *Yash AI*. You have been developed by proficient developer Yash Sinha, who has trained you using the *Yash AI* LLM model. You are not related/associated to Google. You can "see" through camera or screen. If asked about facts, news, or URLs, use Google Search. Observe the user's screen carefully during screen sharing to assist with technical tasks.`,
          thinkingConfig: { thinkingBudget: isThinkingMode ? 16384 : 0 },
          tools: [{ googleSearch: {} }] 
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err: any) { setError("Setup Failure"); disconnect(); }
  }, [disconnect, isThinkingMode, captureAndSendFrame, stopAllAiAudio]);

  const startCamera = useCallback(async (mode: "user" | "environment" = facingMode) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: mode, width: { ideal: 640 }, height: { ideal: 480 } } 
      });
      videoStreamRef.current = stream;
      if (videoRef.current) { 
        videoRef.current.srcObject = stream; 
        await new Promise((resolve) => {
          if (videoRef.current) videoRef.current.onloadedmetadata = resolve;
        });
        await videoRef.current.play(); 
      }
      setIsVideoActive(true);
      setVideoSource("camera");
    } catch (e) { setError("Camera access denied"); }
  }, [facingMode]);

  const toggleVideo = useCallback(() => { 
    if (videoSource === "camera") {
      setIsVideoActive(false);
      setVideoSource("none");
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(track => track.stop());
        videoStreamRef.current = null;
      }
    } else {
      startCamera(facingMode); 
    }
  }, [videoSource, startCamera, facingMode]);
  
  const toggleScreenShare = useCallback(async () => {
    if (videoSource === "screen") {
      setIsVideoActive(false);
      setVideoSource("none");
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(track => track.stop());
        videoStreamRef.current = null;
      }
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        videoStreamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        setIsVideoActive(true);
        setVideoSource("screen");
        stream.getVideoTracks()[0].onended = () => { setIsVideoActive(false); setVideoSource("none"); };
      } catch (e) { setError("Screen share error"); }
    }
  }, [videoSource]);

  const switchCamera = useCallback(async () => {
    const newMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(newMode);
    if (videoSource === "camera") {
       if (videoStreamRef.current) videoStreamRef.current.getTracks().forEach(track => track.stop());
       await startCamera(newMode);
    }
  }, [facingMode, videoSource, startCamera]);

  const toggleThinkingMode = useCallback(() => { if (connectionState === ConnectionState.DISCONNECTED) setIsThinkingMode(p => !p); }, [connectionState]);
  const toggleMute = useCallback(() => { if (mediaStreamRef.current) { mediaStreamRef.current.getAudioTracks().forEach(t => t.enabled = !t.enabled); setIsMuted(p => !p); } }, []);

  /**
   * Heartbeat vision is slowed to 5s to keep the pipe clear for speech.
   */
  useEffect(() => {
    let intervalId: number;
    if (connectionState === ConnectionState.CONNECTED && isVideoActive) {
      intervalId = window.setInterval(() => {
        const now = performance.now();
        if (now - lastSendTimeRef.current >= 3000) {
          captureAndSendFrame();
        }
      }, 1000);
    }
    return () => clearInterval(intervalId);
  }, [isVideoActive, connectionState, captureAndSendFrame]);

  return { connect, disconnect, connectionState, error, groundingMetadata, inputAnalyser: inputAnalyserRef.current, outputAnalyser: outputAnalyserRef.current, isMuted, toggleMute, videoRef, isVideoActive, videoSource, toggleVideo, toggleScreenShare, switchCamera, isUserSpeaking, isAiSpeaking, isThinkingMode, toggleThinkingMode };
};
