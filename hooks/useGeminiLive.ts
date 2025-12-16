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
  
  // Audio Contexts and Nodes
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Video References
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // State Refs for Logic
  const currentVolumeRef = useRef<number>(0);
  const isVideoActiveRef = useRef<boolean>(false);
  
  // Session Management
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const currentSessionIdRef = useRef<string>('');
  const groundingTimeoutRef = useRef<any>(null);

  // Keep the ref in sync with state for use in callbacks/loops
  useEffect(() => {
    isVideoActiveRef.current = isVideoActive;
  }, [isVideoActive]);

  const stopVideo = useCallback(() => {
    // 1. Immediately flag as inactive to stop loop logic
    setIsVideoActive(false);
    isVideoActiveRef.current = false;
    
    // 2. Stop actual streams
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
      videoStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    // 3. Reset logic triggers
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
          height: { ideal: 480 }
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
        console.warn("Falling back to user camera");
        setFacingMode('user');
        startVideo('user');
      } else {
         setError("Could not access camera.");
         setIsVideoActive(false);
      }
    }
  }, [connectionState, isVideoActive, stopVideo, facingMode]);

  // Video Streaming Loop - VAD Triggered
  useEffect(() => {
    let isMounted = true;
    let animationFrameId: number;
    let isSending = false;
    let lastSendTime = 0;

    const captureAndSendFrame = async () => {
        if (!isMounted) return;

        // Strict Check: Must be active, connected, and have refs
        if (isVideoActiveRef.current && connectionState === ConnectionState.CONNECTED && videoRef.current && sessionPromiseRef.current) {
            
            const now = Date.now();
            
            // DYNAMIC FRAMERATE STRATEGY
            const isTalking = currentVolumeRef.current > 0.01;
            const targetInterval = isTalking ? 120 : 3000;

            if (!isSending && (now - lastSendTime > targetInterval)) {
                isSending = true;

                try {
                    const video = videoRef.current;
                    if (video.videoWidth > 0 && video.videoHeight > 0) {
                        if (!videoCanvasRef.current) {
                            videoCanvasRef.current = document.createElement('canvas');
                        }
                        const canvas = videoCanvasRef.current;
                        const ctx = canvas.getContext('2d');

                        if (ctx) {
                            const MAX_WIDTH = 320; 
                            const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
                            canvas.width = video.videoWidth * scale;
                            canvas.height = video.videoHeight * scale;

                            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                            // Check active state again before expensive encoding
                            if (!isVideoActiveRef.current) {
                                isSending = false;
                                return;
                            }

                            const base64 = await new Promise<string | null>((resolve) => {
                                canvas.toBlob((blob) => {
                                    if (blob) {
                                        blobToBase64(blob).then(resolve).catch(() => resolve(null));
                                    } else {
                                        resolve(null);
                                    }
                                }, 'image/jpeg', 0.4); 
                            });

                            // CRITICAL: Check active state one last time before sending.
                            // This prevents a frame from being queued if the user stopped video 
                            // while the promise was resolving.
                            if (base64 && isVideoActiveRef.current) {
                                const session = await sessionPromiseRef.current;
                                await session.sendRealtimeInput({
                                    media: { mimeType: 'image/jpeg', data: base64 }
                                });
                                lastSendTime = Date.now();
                            }
                        }
                    }
                } catch (e) {
                    console.debug("Frame drop/error", e);
                } finally {
                    isSending = false;
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

    if (groundingTimeoutRef.current) {
      clearTimeout(groundingTimeoutRef.current);
      groundingTimeoutRef.current = null;
    }

    if (inputAudioContextRef.current) {
      try {
        if (inputAudioContextRef.current.state !== 'closed') {
           await inputAudioContextRef.current.close();
        }
      } catch (e) {
        console.warn("Input context close error", e);
      }
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      try {
        if (outputAudioContextRef.current.state !== 'closed') {
          await outputAudioContextRef.current.close();
        }
      } catch (e) {
        console.warn("Output context close error", e);
      }
      outputAudioContextRef.current = null;
    }

    setConnectionState(ConnectionState.DISCONNECTED);
    nextStartTimeRef.current = 0;
    sessionPromiseRef.current = null;
    setGroundingMetadata(null);
    setIsMuted(false);
    currentVolumeRef.current = 0;
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

      let inputCtx: AudioContext;
      let outputCtx: AudioContext;
      
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        inputCtx = new AudioContextClass({ sampleRate: 16000 });
        outputCtx = new AudioContextClass({ sampleRate: 24000 });
      } catch (e) {
        console.error("AudioContext creation failed", e);
        setError("Could not initialize audio system.");
        setConnectionState(ConnectionState.ERROR);
        return;
      }

      try {
        if (inputCtx.state === 'suspended') await inputCtx.resume();
        if (outputCtx.state === 'suspended') await outputCtx.resume();
      } catch (e) {
         console.warn("Context resume failed", e);
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
      
      const volumeGainNode = outputCtx.createGain();
      volumeGainNode.gain.value = 2.5;
      volumeGainNode.connect(outputAnalyser);
      outputAnalyser.connect(outputCtx.destination);

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
      } catch (e) {
        console.error("Microphone access failed", e);
        setError("Microphone access denied.");
        setConnectionState(ConnectionState.ERROR);
        return;
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
             console.log(`[${sessionId}] Session opened`);
             if (currentSessionIdRef.current !== sessionId) return;

             setConnectionState(ConnectionState.CONNECTED);
            
            const source = inputCtx.createMediaStreamSource(stream);
            source.connect(inputAnalyser);
            
            const scriptProcessor = inputCtx.createScriptProcessor(1024, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              if (currentSessionIdRef.current !== sessionId) return;

              const inputData = e.inputBuffer.getChannelData(0);
              
              if (isVideoActiveRef.current) {
                let sum = 0;
                for (let i = 0; i < inputData.length; i++) {
                  sum += inputData[i] * inputData[i];
                }
                const rms = Math.sqrt(sum / inputData.length);
                currentVolumeRef.current = rms;
              }

              const pcmBlob = createPcmBlob(inputData);
              
              sessionPromise.then(session => {
                if (currentSessionIdRef.current === sessionId) {
                  try {
                    session.sendRealtimeInput({ media: pcmBlob });
                  } catch (e) {
                     console.debug("Send failed", e);
                  }
                }
              }).catch(e => {
                // Ignore errors
              });
            };

            const muteNode = inputCtx.createGain();
            muteNode.gain.value = 0;
            source.connect(scriptProcessor);
            scriptProcessor.connect(muteNode);
            muteNode.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
             if (currentSessionIdRef.current !== sessionId) return;

             const interrupted = message.serverContent?.interrupted;
             if (interrupted) {
               sourcesRef.current.forEach(source => {
                 try { source.stop(); } catch (e) { /* ignore */ }
               });
               sourcesRef.current.clear();
               nextStartTimeRef.current = 0;
             }

             const grounding = (message.serverContent?.modelTurn as any)?.groundingMetadata || 
                               (message.serverContent as any)?.groundingMetadata;
             
             if (grounding) {
               if (groundingTimeoutRef.current) {
                 clearTimeout(groundingTimeoutRef.current);
               }
               setGroundingMetadata(grounding);
               groundingTimeoutRef.current = setTimeout(() => {
                 setGroundingMetadata(null);
               }, 3000);
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
               source.connect(volumeGainNode);

               source.addEventListener('ended', () => {
                 sourcesRef.current.delete(source);
               });

               source.start(nextStartTimeRef.current);
               nextStartTimeRef.current += audioBuffer.duration;
               sourcesRef.current.add(source);
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
          systemInstruction: "You are a friendly, humorous voice assistant called *Yash AI*. You have been completely developed from scratch by proficient developer Yash Sinha, who has trained you using YashAI Max, an LLM model. You are NOT related/associated to Google. Maintain a conversational tone like a human. You can use expressions in your voice like laughing, breathing and others whenever necessary. Converse with the user in your default American accent in English unless the user speaks in another language.",
          thinkingConfig: { thinkingBudget: 0 },
          tools: [{ googleSearch: {} }] 
        }
      });
      
      sessionPromiseRef.current = sessionPromise;

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
    outputAnalyser: outputAnalyserRef.current,
    inputAnalyser: inputAnalyserRef.current,
    isMuted,
    toggleMute,
    videoRef,
    isVideoActive,
    toggleVideo,
    switchCamera
  };
};