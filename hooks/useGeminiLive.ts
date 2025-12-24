
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
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastCapturedTimeRef = useRef<number>(0);
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
          systemInstruction: `System time: ${currentDateTime}. You are Yash AI. You can see through the camera. Respond naturally to visual cues.`,
          thinkingConfig: { thinkingBudget: isThinkingMode ? 16384 : 0 },
          tools: [{ googleSearch: {} }] 
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err: any) { setError("Initialization failed"); disconnect(); }
  }, [disconnect, isThinkingMode]);

  const startCamera = useCallback(async (mode: "user" | "environment" = facingMode) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } } 
      });
      videoStreamRef.current = stream;
      if (videoRef.current) { 
        videoRef.current.srcObject = stream; 
        // Ensure metadata is loaded to get videoWidth/videoHeight
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

  // Optimized Vision Capture Loop
  // This loop runs via requestAnimationFrame to stay perfectly in sync with the video rendering
  useEffect(() => {
    let frameId: number;
    
    const capture = (now: number) => {
      const video = videoRef.current;
      const session = activeSessionRef.current;
      
      // We only capture if video is active, session is connected, and at least 500ms has passed
      // 500ms is a good balance for "real-time" vision vs bandwidth
      if (isVideoActive && connectionState === ConnectionState.CONNECTED && session && video && video.readyState >= 2) {
        
        // Ensure we are getting a new frame from the hardware
        if (now - lastSendTimeRef.current > 600) {
          if (!videoCanvasRef.current) videoCanvasRef.current = document.createElement('canvas');
          const canvas = videoCanvasRef.current;
          const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
          
          if (ctx) {
            // High-fidelity capture: use ideal dimensions for the model
            // 640x480 is standard. We maintain aspect ratio based on the video source.
            const ratio = video.videoHeight / video.videoWidth;
            canvas.width = 640;
            canvas.height = Math.floor(640 * ratio);
            
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // toDataURL can be slow, but it's the most reliable for getting the raw bytes
            // We use 0.7 quality to keep payload small but legible
            const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
            
            // Send to Gemini
            session.sendRealtimeInput({ 
              media: { 
                mimeType: 'image/jpeg', 
                data: base64 
              } 
            });
            
            lastSendTimeRef.current = now;
          }
        }
      }
      frameId = requestAnimationFrame(capture);
    };
    
    frameId = requestAnimationFrame(capture);
    return () => cancelAnimationFrame(frameId);
  }, [isVideoActive, connectionState]);

  return { connect, disconnect, connectionState, error, groundingMetadata, inputAnalyser: inputAnalyserRef.current, outputAnalyser: outputAnalyserRef.current, isMuted, toggleMute, videoRef, isVideoActive, videoSource, toggleVideo, toggleScreenShare, switchCamera, isUserSpeaking, isAiSpeaking, isThinkingMode, toggleThinkingMode };
};
