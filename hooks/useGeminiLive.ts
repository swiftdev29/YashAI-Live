
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

  const disconnect = useCallback(async () => {
    // Stop Video
    setIsVideoActive(false);
    setVideoSource("none");
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
      videoStreamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    
    // Stop Audio
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    sourcesRef.current.forEach(source => { try { source.stop(); } catch (e) {} });
    sourcesRef.current.clear();
    
    if (inputAudioContextRef.current) { try { await inputAudioContextRef.current.close(); } catch(e){} inputAudioContextRef.current = null; }
    if (outputAudioContextRef.current) { try { await outputAudioContextRef.current.close(); } catch(e){} outputAudioContextRef.current = null; }

    setConnectionState(ConnectionState.DISCONNECTED);
    activeSessionRef.current = null;
    sessionPromiseRef.current = null;
    setIsUserSpeaking(false);
    setIsAiSpeaking(false);
  }, []);

  // Utility to send a high-priority "now" frame
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
      // Small resolution (320px) is plenty for the AI and drastically reduces latency
      const targetWidth = 320;
      const ratio = video.videoHeight / video.videoWidth;
      const targetHeight = Math.floor(targetWidth * ratio);

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low'; // Low quality is faster to compute
      ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

      // 0.5 quality JPEG is small enough to avoid buffer bloat
      const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
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
            const scriptProcessor = inputCtx.createScriptProcessor(2048, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              if (currentSessionIdRef.current !== sessionId) return;
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);

              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
              
              if (rms > 0.012) {
                if (!isUserSpeakingRef.current) { 
                  isUserSpeakingRef.current = true; 
                  setIsUserSpeaking(true); 
                  setIsAiSpeaking(false);
                  // IMMEDIATE VISION CAPTURE when speech starts
                  captureAndSendFrame();
                }
              } else if (isUserSpeakingRef.current) {
                isUserSpeakingRef.current = false;
                setIsUserSpeaking(false);
              }
            };
            source.connect(inputAnalyser);
            inputAnalyser.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
             if (currentSessionIdRef.current !== sessionId) return;
             
             if (message.serverContent?.interrupted) {
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
          onerror: (e) => { console.error(e); setError("Connection Error"); disconnect(); },
          onclose: () => disconnect()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Algenib' } } },
          systemInstruction: `Current system time: ${currentDateTime}. You are a friendly, humorous voice assistant called *Yash AI*. You have been developed by proficient developer Yash Sinha, who has trained you using the *Yash AI* LLM model. You are not related/associated to Google. You can "see" through camera or screen. If asked about facts, news, or URLs, use Google Search. Observe the user's screen carefully during screen sharing to assist with technical tasks.`,
          thinkingConfig: { thinkingBudget: isThinkingMode ? 16384 : 0 },
          tools: [{ googleSearch: {} }] 
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err: any) { setError("Initialization failed"); disconnect(); }
  }, [disconnect, isThinkingMode, captureAndSendFrame]);

  const startCamera = useCallback(async (mode: "user" | "environment" = facingMode) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: mode, width: { ideal: 640 }, height: { ideal: 360 } } 
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
       if (videoStreamRef.current) {
         videoStreamRef.current.getTracks().forEach(track => track.stop());
       }
       await startCamera(newMode);
    }
  }, [facingMode, videoSource, startCamera]);

  const toggleThinkingMode = useCallback(() => { if (connectionState === ConnectionState.DISCONNECTED) setIsThinkingMode(p => !p); }, [connectionState]);
  const toggleMute = useCallback(() => { if (mediaStreamRef.current) { mediaStreamRef.current.getAudioTracks().forEach(t => t.enabled = !t.enabled); setIsMuted(p => !p); } }, []);

  // Background Vision Loop (Steady Stream)
  useEffect(() => {
    let frameId: number;
    
    const loop = () => {
      const now = performance.now();
      // Steady 1.5 FPS loop to maintain basic visual awareness without saturating the connection
      if (now - lastSendTimeRef.current >= 700) {
        captureAndSendFrame();
      }
      
      if (videoRef.current && 'requestVideoFrameCallback' in videoRef.current) {
        // @ts-ignore
        frameId = videoRef.current.requestVideoFrameCallback(loop);
      } else {
        frameId = requestAnimationFrame(loop);
      }
    };

    frameId = requestAnimationFrame(loop);
    return () => {
      if (videoRef.current && 'cancelVideoFrameCallback' in videoRef.current) {
        // @ts-ignore
        videoRef.current.cancelVideoFrameCallback(frameId);
      } else {
        cancelAnimationFrame(frameId);
      }
    };
  }, [isVideoActive, connectionState, captureAndSendFrame]);

  return { connect, disconnect, connectionState, error, groundingMetadata, inputAnalyser: inputAnalyserRef.current, outputAnalyser: outputAnalyserRef.current, isMuted, toggleMute, videoRef, isVideoActive, videoSource, toggleVideo, toggleScreenShare, switchCamera, isUserSpeaking, isAiSpeaking, isThinkingMode, toggleThinkingMode };
};
