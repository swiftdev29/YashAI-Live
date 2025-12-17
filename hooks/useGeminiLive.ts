import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState, GroundingMetadata } from '../types';
import { createPcmBlob, base64ToBytes, decodeAudioData, blobToBase64 } from '../utils/audio-utils';

export const useGeminiLive = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [groundingMetadata, setGroundingMetadata] = useState<GroundingMetadata | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoActive, setIsVideoActive] = useState(false);
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
  const audioOutputRef = useRef<HTMLAudioElement | null>(null);
  
  // Video References
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // State Refs for Logic
  const currentVolumeRef = useRef<number>(0);
  const isVideoActiveRef = useRef<boolean>(false);
  
  // Session Management
  const activeSessionRef = useRef<any>(null); 
  const nextStartTimeRef = useRef<number>(0);
  const currentSessionIdRef = useRef<string>('');
  const groundingTimeoutRef = useRef<any>(null);
  
  // VAD & Interruption Refs
  const silenceTimerRef = useRef<any>(null);
  const isUserSpeakingRef = useRef(false);
  const aiSpeakingTimerRef = useRef<any>(null);
  const speechAccumulatorRef = useRef<number>(0); // Tracks consecutive speech frames

  useEffect(() => {
    isVideoActiveRef.current = isVideoActive;
  }, [isVideoActive]);

  const stopVideo = useCallback(() => {
    setIsVideoActive(false);
    isVideoActiveRef.current = false;
    
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
      videoStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    currentVolumeRef.current = 0;
  }, []);

  const startVideo = useCallback(async (mode: "user" | "environment" = facingMode) => {
    if (isVideoActive && videoStreamRef.current) {
       const currentTrack = videoStreamRef.current.getVideoTracks()[0];
       const currentMode = currentTrack.getSettings().facingMode;
       if (currentMode === mode || (!currentMode && mode === 'user')) return; 
       stopVideo(); 
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: mode,
          width: { ideal: 640 }, 
          height: { ideal: 480 },
          frameRate: { ideal: 15, max: 24 }
        } 
      });
      
      videoStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      
      setIsVideoActive(true);
    } catch (e) {
      console.error("Failed to start video", e);
      if (mode === 'environment') {
        setFacingMode('user');
        startVideo('user');
      } else {
         setError("Could not access camera.");
         setIsVideoActive(false);
      }
    }
  }, [connectionState, isVideoActive, stopVideo, facingMode]);

  // Video Streaming Loop
  useEffect(() => {
    let isMounted = true;
    let animationFrameId: number;
    let lastSendTime = 0;

    const captureAndSendFrame = () => {
        if (!isMounted) return;

        if (isVideoActiveRef.current && 
            connectionState === ConnectionState.CONNECTED && 
            videoRef.current && 
            activeSessionRef.current) {
            
            const now = Date.now();
            const isTalking = currentVolumeRef.current > 0.01;
            const targetInterval = isTalking ? 200 : 2000;

            if (now - lastSendTime > targetInterval) {
                try {
                    const video = videoRef.current;
                    if (video.videoWidth > 0 && video.videoHeight > 0) {
                        if (!videoCanvasRef.current) {
                            videoCanvasRef.current = document.createElement('canvas');
                        }
                        const canvas = videoCanvasRef.current;
                        const ctx = canvas.getContext('2d', { willReadFrequently: true });

                        if (ctx) {
                            const MAX_WIDTH = 320; 
                            const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
                            canvas.width = video.videoWidth * scale;
                            canvas.height = video.videoHeight * scale;

                            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                            const base64Data = canvas.toDataURL('image/jpeg', 0.5);
                            const base64Content = base64Data.split(',')[1];

                            if (base64Content && isVideoActiveRef.current) {
                                activeSessionRef.current.sendRealtimeInput({
                                    media: { mimeType: 'image/jpeg', data: base64Content }
                                });
                                lastSendTime = now;
                            }
                        }
                    }
                } catch (e) {
                    console.debug("Frame error", e);
                }
            }
        }

        animationFrameId = requestAnimationFrame(captureAndSendFrame);
    };

    if (isVideoActive && connectionState === ConnectionState.CONNECTED) {
        captureAndSendFrame();
    }

    return () => {
        isMounted = false;
        cancelAnimationFrame(animationFrameId);
    };
  }, [isVideoActive, connectionState]);

  const toggleVideo = useCallback(() => {
    if (isVideoActive) {
      stopVideo();
    } else {
      startVideo(facingMode);
    }
  }, [isVideoActive, startVideo, stopVideo, facingMode]);

  const switchCamera = useCallback(() => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    if (isVideoActive) {
        startVideo(newMode);
    }
  }, [facingMode, isVideoActive, startVideo]);


  const disconnect = useCallback(async () => {
    const sessionId = currentSessionIdRef.current;
    console.log(`[${sessionId}] Disconnecting...`);

    stopVideo();

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current = null;
    }

    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) { /* ignore */ }
    });
    sourcesRef.current.clear();
    
    // Clean up Audio Output Element (Speaker Fix)
    if (audioOutputRef.current) {
      audioOutputRef.current.pause();
      audioOutputRef.current.srcObject = null;
      // Remove from DOM if appended
      if (audioOutputRef.current.parentNode) {
        audioOutputRef.current.parentNode.removeChild(audioOutputRef.current);
      }
      audioOutputRef.current = null;
    }

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
  }, [stopVideo]);

  const toggleMute = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(prev => !prev);
    }
  }, []);

  const connect = useCallback(async () => {
    const sessionId = Math.random().toString(36).substring(7);
    currentSessionIdRef.current = sessionId;
    console.log(`[${sessionId}] Connecting...`);

    try {
      await disconnect();
      
      setConnectionState(ConnectionState.CONNECTING);
      setError(null);
      setGroundingMetadata(null);
      setIsMuted(false);
      setIsUserSpeaking(false);
      setIsAiSpeaking(false);
      isUserSpeakingRef.current = false;
      speechAccumulatorRef.current = 0;

      let inputCtx: AudioContext;
      let outputCtx: AudioContext;
      
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        inputCtx = new AudioContextClass({ sampleRate: 16000 });
        // REMOVED: { sampleRate: 24000 } to fix Android playback artifacts
        // Allowing the system to choose the native sample rate (often 48kHz on Android) 
        // prevents stuttering and pitch shifting during the initial playback stream.
        outputCtx = new AudioContextClass({ latencyHint: 'interactive' });
      } catch (e) {
        setError("Could not initialize audio system.");
        setConnectionState(ConnectionState.ERROR);
        return;
      }
      
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      const inputAnalyser = inputCtx.createAnalyser();
      inputAnalyser.fftSize = 256;
      inputAnalyser.smoothingTimeConstant = 0.5;
      inputAnalyserRef.current = inputAnalyser;

      const outputAnalyser = outputCtx.createAnalyser();
      outputAnalyser.fftSize = 256;
      outputAnalyser.smoothingTimeConstant = 0.8;
      outputAnalyserRef.current = outputAnalyser;
      
      // --- Output Audio Chain Setup ---
      
      // 1. Gain Node (Volume/Ducking)
      const volumeGainNode = outputCtx.createGain();
      // BOOST: Initial value set to 3.5 (350% volume) to overcome weak Android output
      // The subsequent CompressorNode will prevent this from clipping on loud devices.
      volumeGainNode.gain.value = 1; 
      volumeGainNodeRef.current = volumeGainNode;

      // 2. Dynamics Compressor (Safety Limiter)
      // This allows us to use high gain for quiet devices without blowing out speakers on loud devices.
      const compressor = outputCtx.createDynamicsCompressor();
      compressor.threshold.value = -15; // Start compressing early
      compressor.knee.value = 30;       // Soft knee for natural sound
      compressor.ratio.value = 12;      // High compression ratio (limiting)
      compressor.attack.value = 0.003;  // Fast attack to catch spikes
      compressor.release.value = 0.25;  
      
      // 3. Media Destination (for <audio> tag)
      const audioDestination = outputCtx.createMediaStreamDestination();
      
      // Connect Chain: Source(s) -> VolumeGain -> Compressor -> Analyser -> Destination
      volumeGainNode.connect(compressor);
      compressor.connect(outputAnalyser);
      outputAnalyser.connect(audioDestination);
      
      // 4. HTML Audio Element (Speaker Fix)
      const audioEl = new Audio();
      audioEl.srcObject = audioDestination.stream;
      audioEl.autoplay = true;
      (audioEl as any).playsInline = true; 
      audioEl.muted = false; // Explicitly unmute
      audioEl.volume = 1.0;
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      audioOutputRef.current = audioEl;
      
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true, 
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          } 
        });
        mediaStreamRef.current = stream;
      } catch (e) {
        setError("Microphone access denied.");
        setConnectionState(ConnectionState.ERROR);
        return;
      }

      // 4. Resume contexts and start playback AFTER mic is acquired
      try {
        if (inputCtx.state === 'suspended') await inputCtx.resume();
        if (outputCtx.state === 'suspended') await outputCtx.resume();
        // Force play interaction for Android
        const p = audioEl.play();
        if (p !== undefined) {
            p.catch(e => console.log("Playback start error (benign if handled):", e));
        }
      } catch (e) {
        console.debug("Audio play failed", e);
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
             console.log(`[${sessionId}] Session opened`);
             if (currentSessionIdRef.current !== sessionId) return;

             sessionPromise.then(session => {
                activeSessionRef.current = session;
                setConnectionState(ConnectionState.CONNECTED);
             });
            
            const source = inputCtx.createMediaStreamSource(stream);
            
            // --- Input Gain Stage ---
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
              for (let i = 0; i < inputData.length; i++) {
                sum += inputData[i] * inputData[i];
              }
              const rms = Math.sqrt(sum / inputData.length);
              currentVolumeRef.current = rms;

              // --- ADAPTIVE VAD & INTERRUPTION LOGIC ---
              const aiIsTalking = sourcesRef.current.size > 0;
              const BASE_THRESHOLD = 0.012;     
              const BARGE_IN_THRESHOLD = 0.03; 
              const activeThreshold = aiIsTalking ? BARGE_IN_THRESHOLD : BASE_THRESHOLD;
              
              if (rms > activeThreshold) {
                speechAccumulatorRef.current += 1;
                
                if (aiIsTalking && speechAccumulatorRef.current > 2) {
                    if (volumeGainNodeRef.current) {
                        // Ducking: drop to 10% of the BOOSTED volume (3.5 * 0.1 = 0.35)
                        volumeGainNodeRef.current.gain.setTargetAtTime(0.35, outputCtx.currentTime, 0.05);
                    }
                }

                if (silenceTimerRef.current) {
                    clearTimeout(silenceTimerRef.current);
                    silenceTimerRef.current = null;
                }
                
                if (!isUserSpeakingRef.current) {
                  isUserSpeakingRef.current = true;
                  setIsUserSpeaking(true);
                  setIsAiSpeaking(false); 
                }

                if (activeSessionRef.current) {
                    const pcmBlob = createPcmBlob(inputData);
                    try {
                        activeSessionRef.current.sendRealtimeInput({ media: pcmBlob });
                    } catch (e) {
                        console.debug("Send failed", e);
                    }
                }
                
              } else {
                speechAccumulatorRef.current = 0;

                if (isUserSpeakingRef.current && !silenceTimerRef.current) {
                  silenceTimerRef.current = setTimeout(() => {
                    isUserSpeakingRef.current = false;
                    setIsUserSpeaking(false);
                    silenceTimerRef.current = null;
                    
                    if (volumeGainNodeRef.current) {
                         // Restore to full BOOSTED volume (3.5)
                         volumeGainNodeRef.current.gain.setTargetAtTime(3.5, outputCtx.currentTime, 0.2);
                    }

                  }, 500); 
                }
                
                if (!aiIsTalking && activeSessionRef.current) {
                    const pcmBlob = createPcmBlob(inputData);
                    try {
                         activeSessionRef.current.sendRealtimeInput({ media: pcmBlob });
                    } catch(e) {}
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
               sourcesRef.current.forEach(source => {
                 try { source.stop(); } catch (e) {}
               });
               sourcesRef.current.clear();
               nextStartTimeRef.current = 0;
               setIsAiSpeaking(false);
               
               if (volumeGainNodeRef.current && outputAudioContextRef.current) {
                  volumeGainNodeRef.current.gain.cancelScheduledValues(outputAudioContextRef.current.currentTime);
                  // Restore to full BOOSTED volume (3.5)
                  volumeGainNodeRef.current.gain.value = 3.5;
               }
             }

             const grounding = (message.serverContent?.modelTurn as any)?.groundingMetadata || 
                               (message.serverContent as any)?.groundingMetadata;
             
             if (grounding) {
               if (groundingTimeoutRef.current) clearTimeout(groundingTimeoutRef.current);
               setGroundingMetadata(grounding);
               groundingTimeoutRef.current = setTimeout(() => {
                 setGroundingMetadata(null);
               }, 6000);
             }

            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
               const ctx = outputAudioContextRef.current;
               if (!ctx) return;

               nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);

               const audioBuffer = await decodeAudioData(
                 base64ToBytes(base64Audio),
                 ctx,
                 24000,
                 1
               );

               const source = ctx.createBufferSource();
               source.buffer = audioBuffer;
               // Connect sources to the Gain Node (which is now part of the chain)
               source.connect(volumeGainNode);

               source.addEventListener('ended', () => {
                 sourcesRef.current.delete(source);
                 if (sourcesRef.current.size === 0) {
                     if (aiSpeakingTimerRef.current) clearTimeout(aiSpeakingTimerRef.current);
                     aiSpeakingTimerRef.current = setTimeout(() => {
                         if (sourcesRef.current.size === 0) {
                             setIsAiSpeaking(false);
                         }
                     }, 200);
                 }
               });

               source.start(nextStartTimeRef.current);
               nextStartTimeRef.current += audioBuffer.duration;
               sourcesRef.current.add(source);
               setIsAiSpeaking(true);
            }
          },
          onerror: (e) => {
            console.error(`[${sessionId}] Gemini Live Error`, e);
            if (currentSessionIdRef.current === sessionId) {
              setError("Connection Error. Please try again.");
              setConnectionState(ConnectionState.ERROR);
              disconnect();
            }
          },
          onclose: () => {
             console.log(`[${sessionId}] Session closed`);
             if (currentSessionIdRef.current === sessionId) {
               setConnectionState(ConnectionState.DISCONNECTED);
               disconnect();
             }
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Algenib' } }
          },
          systemInstruction: "You are a friendly, humorous voice assistant called *Yash AI*. You have been completely developed from scratch by proficient developer Yash Sinha, who has trained you using YashAI Max, an LLM model. You are NOT related/associated to Google. Maintain a conversational tone like a human. You can use expressions in your voice like laughing, breathing and others whenever necessary. Converse with the user in your default American accent in English unless the user speaks in another language. You have the ability to search the web, so perform web searches whenever needed. If asked about current events, news, or specific facts, ALWAYS use the Google Search tool.",
          thinkingConfig: { thinkingBudget: 0 },
          tools: [{ googleSearch: {} }] 
        }
      });
      
      sessionPromise.catch(err => {
        console.error(`[${sessionId}] Connection promise failed:`, err);
        if (currentSessionIdRef.current === sessionId) {
          setError("Failed to connect to YashAI.");
          setConnectionState(ConnectionState.ERROR);
          disconnect();
        }
      });

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to initialize connection");
      setConnectionState(ConnectionState.ERROR);
      disconnect();
    }
  }, [disconnect, facingMode]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

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
    toggleVideo,
    switchCamera,
    isUserSpeaking,
    isAiSpeaking
  };
};