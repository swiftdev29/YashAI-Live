import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState, GroundingMetadata } from '../types';
import { createPcmBlob, base64ToBytes, decodeAudioData, blobToBase64 } from '../utils/audio-utils';

export const useGeminiLive = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [groundingMetadata, setGroundingMetadata] = useState<GroundingMetadata | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  
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
  
  // State Refs for Logic
  const currentVolumeRef = useRef<number>(0);
  const isVideoActiveRef = useRef<boolean>(false);
  const videoSourceRef = useRef<"camera" | "screen" | "none">("none");
  
  // Session Management
  const activeSessionRef = useRef<any>(null); 
  const nextStartTimeRef = useRef<number>(0);
  const currentSessionIdRef = useRef<string>('');
  const groundingTimeoutRef = useRef<any>(null);
  
  // VAD & Interruption Refs
  const silenceTimerRef = useRef<any>(null);
  const isUserSpeakingRef = useRef(false);
  const aiSpeakingTimerRef = useRef<any>(null);
  const speechAccumulatorRef = useRef<number>(0);

  // Sync refs with state for the capture loop
  useEffect(() => {
    isVideoActiveRef.current = isVideoActive;
    videoSourceRef.current = videoSource;
  }, [isVideoActive, videoSource]);

  // --- Media Session Helper ---
  const updateMediaSession = useCallback((state: 'playing' | 'paused' | 'none') => {
    if ('mediaSession' in navigator) {
      if (state === 'none') {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        return;
      }

      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'YashAI Voice Session',
        artist: 'Yash AI',
        album: 'Live Conversation',
        artwork: [
          { src: 'https://raw.githubusercontent.com/swiftdev29/Jee-mains-checker/refs/heads/main/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' }
        ]
      });

      navigator.mediaSession.playbackState = state;
      navigator.mediaSession.setActionHandler('stop', () => disconnect());
      navigator.mediaSession.setActionHandler('pause', () => disconnect());
    }
  }, []);

  const stopVideo = useCallback(() => {
    setIsVideoActive(false);
    setVideoSource("none");
    isVideoActiveRef.current = false;
    videoSourceRef.current = "none";
    
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
      videoStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    currentVolumeRef.current = 0;
  }, []);

  const startCamera = useCallback(async (mode: "user" | "environment" = facingMode) => {
    if (videoSourceRef.current === "screen") stopVideo();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: mode, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 } } 
      });
      videoStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsVideoActive(true);
      setVideoSource("camera");
    } catch (e) {
      setError("Could not access camera.");
      setIsVideoActive(false);
    }
  }, [facingMode, stopVideo]);

  const startScreenShare = useCallback(async () => {
    if (videoSourceRef.current === "camera") stopVideo();
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { cursor: "always", frameRate: { ideal: 10, max: 15 } },
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

  const switchCamera = useCallback(() => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    if (videoSource === 'camera') startCamera(newMode);
  }, [facingMode, videoSource, startCamera]);

  // Video Streaming Loop
  useEffect(() => {
    let isMounted = true;
    let animationFrameId: number;
    let lastSendTime = 0;

    const captureAndSendFrame = () => {
        if (!isMounted) return;
        if (isVideoActiveRef.current && connectionState === ConnectionState.CONNECTED && videoRef.current && activeSessionRef.current) {
            const now = Date.now();
            
            // LOGIC: High frequency (250ms) if talking OR if screen sharing.
            // Screen sharing needs frequent updates to capture movement/scrolling.
            // Camera can drop to 2000ms heartbeat when silent to save battery.
            const isScreenShare = videoSourceRef.current === "screen";
            const targetInterval = (currentVolumeRef.current > 0.01 || isScreenShare) ? 500 : 2000;

            if (now - lastSendTime > targetInterval) {
                try {
                    const video = videoRef.current;
                    if (video.videoWidth > 0 && video.videoHeight > 0) {
                        if (!videoCanvasRef.current) videoCanvasRef.current = document.createElement('canvas');
                        const canvas = videoCanvasRef.current;
                        const ctx = canvas.getContext('2d', { willReadFrequently: true });
                        if (ctx) {
                            const scale = Math.min(1, 480 / video.videoWidth); // Slightly higher res for screen share
                            canvas.width = video.videoWidth * scale;
                            canvas.height = video.videoHeight * scale;
                            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                            const base64Data = canvas.toDataURL('image/jpeg', 0.6); // Quality 0.6
                            const base64Content = base64Data.split(',')[1];
                            if (base64Content && isVideoActiveRef.current) {
                                activeSessionRef.current.sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: base64Content } });
                                lastSendTime = now;
                            }
                        }
                    }
                } catch (e) {
                    console.debug("Capture error", e);
                }
            }
        }
        animationFrameId = requestAnimationFrame(captureAndSendFrame);
    };

    if (isVideoActive && connectionState === ConnectionState.CONNECTED) {
        captureAndSendFrame();
    }

    return () => { isMounted = false; cancelAnimationFrame(animationFrameId); };
  }, [isVideoActive, connectionState]);

  const disconnect = useCallback(async () => {
    const sessionId = currentSessionIdRef.current;
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
      try { if (inputAudioContextRef.current.state !== 'closed') await inputAudioContextRef.current.close(); } catch (e) {}
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      try { if (outputAudioContextRef.current.state !== 'closed') await outputAudioContextRef.current.close(); } catch (e) {}
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
    speechAccumulatorRef.current = 0;
  }, [stopVideo, updateMediaSession]);

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
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } 
      });
      mediaStreamRef.current = stream;

      try {
        if (inputCtx.state === 'suspended') await inputCtx.resume();
        if (outputCtx.state === 'suspended') await outputCtx.resume();
      } catch (e) {}

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const currentDateTime = new Date().toLocaleString();
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
             if (currentSessionIdRef.current !== sessionId) return;
             sessionPromise.then(session => {
                activeSessionRef.current = session;
                setConnectionState(ConnectionState.CONNECTED);
                updateMediaSession('playing');
             });
            
            const source = inputCtx.createMediaStreamSource(stream);
            const inputGain = inputCtx.createGain();
            inputGain.gain.value = 1.5;
            source.connect(inputGain);
            inputGain.connect(inputAnalyser);
            
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
                if (aiIsTalking && speechAccumulatorRef.current > 2) {
                    volumeGainNodeRef.current?.gain.setTargetAtTime(0.2, outputCtx.currentTime, 0.05);
                }
                if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
                if (!isUserSpeakingRef.current) { isUserSpeakingRef.current = true; setIsUserSpeaking(true); setIsAiSpeaking(false); }
                if (activeSessionRef.current) {
                    try { activeSessionRef.current.sendRealtimeInput({ media: createPcmBlob(inputData) }); } catch (e) {}
                }
              } else {
                speechAccumulatorRef.current = 0;
                if (isUserSpeakingRef.current && !silenceTimerRef.current) {
                  silenceTimerRef.current = setTimeout(() => {
                    isUserSpeakingRef.current = false; setIsUserSpeaking(false); silenceTimerRef.current = null;
                    volumeGainNodeRef.current?.gain.setTargetAtTime(1.0, outputCtx.currentTime, 0.2);
                  }, 500); 
                }
                if (!aiIsTalking && activeSessionRef.current) {
                    try { activeSessionRef.current.sendRealtimeInput({ media: createPcmBlob(inputData) }); } catch(e) {}
                }
              }
            };
            const voidDestination = inputCtx.createMediaStreamDestination();
            const muteNode = inputCtx.createGain();
            muteNode.gain.value = 0;
            inputGain.connect(scriptProcessor);
            scriptProcessor.connect(muteNode);
            muteNode.connect(voidDestination);
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
               if (ctx.state === 'suspended') try { await ctx.resume(); } catch(e) {}
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
          onerror: (e) => {
            if (currentSessionIdRef.current === sessionId) {
              setError("Connection Error. Please try again.");
              setConnectionState(ConnectionState.ERROR);
              disconnect();
            }
          },
          onclose: () => {
             if (currentSessionIdRef.current === sessionId) {
               setConnectionState(ConnectionState.DISCONNECTED);
               disconnect();
             }
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Algenib' } } },
          systemInstruction: `Current system time: ${currentDateTime}. You are a friendly, humorous voice assistant called *Yash AI*. You have been completely developed from scratch by proficient developer Yash Sinha, who has trained you using YashAI Max, an LLM model. You are NOT related/associated to Google. Maintain a conversational tone. You can use expressions in your voice like laughing, breathing and others whenever necessary. You can "see" through the user's camera OR through their screen if they choose to share it. Use this visual information to provide helpful, context-aware assistance. If asked about current events, news, or specific facts, ALWAYS use the Google Search tool.`,
          thinkingConfig: { thinkingBudget: 0 },
          tools: [{ googleSearch: {} }] 
        }
      });
      sessionPromise.catch(err => {
        if (currentSessionIdRef.current === sessionId) {
          setError("Failed to connect to YashAI.");
          setConnectionState(ConnectionState.ERROR);
          disconnect();
        }
      });
    } catch (err: any) {
      setError(err.message || "Failed to initialize connection");
      setConnectionState(ConnectionState.ERROR);
      disconnect();
    }
  }, [disconnect, facingMode, updateMediaSession]);

  useEffect(() => { return () => { disconnect(); }; }, [disconnect]);

  return {
    connect, disconnect, connectionState, error, groundingMetadata,
    inputAnalyser: inputAnalyserRef.current,
    outputAnalyser: outputAnalyserRef.current,
    isMuted, toggleMute, videoRef, isVideoActive, videoSource,
    toggleVideo, toggleScreenShare, switchCamera,
    isUserSpeaking, isAiSpeaking
  };
};