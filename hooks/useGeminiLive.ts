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
  const videoIntervalRef = useRef<number | null>(null);

  // Session Management
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const currentSessionIdRef = useRef<string>('');
  const groundingTimeoutRef = useRef<any>(null);

  const stopVideo = useCallback(() => {
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
      videoStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsVideoActive(false);
  }, []);

  const disconnect = useCallback(async () => {
    const sessionId = currentSessionIdRef.current;
    console.log(`[${sessionId}] Disconnecting...`);

    // Stop Video first
    stopVideo();

    // Stop Microphone Stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Stop Script Processor
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current = null;
    }

    // Stop all playing sources
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) { /* ignore */ }
    });
    sourcesRef.current.clear();

    // Clear Grounding Timeout
    if (groundingTimeoutRef.current) {
      clearTimeout(groundingTimeoutRef.current);
      groundingTimeoutRef.current = null;
    }

    // Close Audio Contexts
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
  }, [stopVideo]);

  const toggleMute = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(prev => !prev);
    }
  }, []);

  const startVideo = useCallback(async () => {
    if (isVideoActive) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 }, 
          height: { ideal: 480 },
          facingMode: "user" 
        } 
      });
      
      videoStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      
      setIsVideoActive(true);

      // Setup Frame Capture Loop
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const JPEG_QUALITY = 0.5;

      // 2 FPS (500ms interval) to balance bandwidth and responsiveness
      videoIntervalRef.current = window.setInterval(async () => {
        if (!ctx || !videoRef.current || !sessionPromiseRef.current) return;
        
        // Ensure we only process if connected
        if (connectionState !== ConnectionState.CONNECTED) return;

        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        ctx.drawImage(videoRef.current, 0, 0);

        canvas.toBlob(async (blob) => {
          if (blob) {
            try {
              const base64Data = await blobToBase64(blob);
              sessionPromiseRef.current?.then(session => {
                try {
                    session.sendRealtimeInput({
                      media: {
                        mimeType: 'image/jpeg',
                        data: base64Data
                      }
                    });
                } catch(e) {
                    console.debug("Frame send error", e);
                }
              });
            } catch (e) {
               console.debug("Blob conversion error", e);
            }
          }
        }, 'image/jpeg', JPEG_QUALITY);

      }, 500);

    } catch (e) {
      console.error("Failed to start video", e);
      setError("Could not access camera.");
    }
  }, [connectionState, isVideoActive, error]);

  const toggleVideo = useCallback(() => {
    if (isVideoActive) {
      stopVideo();
    } else {
      startVideo();
    }
  }, [isVideoActive, startVideo, stopVideo]);


  const connect = useCallback(async () => {
    const sessionId = Math.random().toString(36).substring(7);
    currentSessionIdRef.current = sessionId;
    console.log(`[${sessionId}] Connecting...`);

    try {
      // Ensure any previous connection is fully cleaned up
      await disconnect();
      
      setConnectionState(ConnectionState.CONNECTING);
      setError(null);
      setGroundingMetadata(null);
      setIsMuted(false);

      // 1. Setup Audio Contexts
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

      // Resume contexts immediately
      try {
        if (inputCtx.state === 'suspended') await inputCtx.resume();
        if (outputCtx.state === 'suspended') await outputCtx.resume();
      } catch (e) {
         console.warn("Context resume failed", e);
      }
      
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      // 2. Setup Analysers and Gain
      const inputAnalyser = inputCtx.createAnalyser();
      inputAnalyser.fftSize = 256;
      inputAnalyser.smoothingTimeConstant = 0.5;
      inputAnalyserRef.current = inputAnalyser;

      const outputAnalyser = outputCtx.createAnalyser();
      outputAnalyser.fftSize = 256;
      // Visualization: Restore 0.8 smoothing for liquid waveform effect
      outputAnalyser.smoothingTimeConstant = 0.8;
      outputAnalyserRef.current = outputAnalyser;
      
      const volumeGainNode = outputCtx.createGain();
      volumeGainNode.gain.value = 2.5;
      volumeGainNode.connect(outputAnalyser);
      outputAnalyser.connect(outputCtx.destination);

      // 3. Get Microphone Access
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

      // 4. Initialize Gemini Client
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // 5. Start Session
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
             console.log(`[${sessionId}] Session opened`);
             if (currentSessionIdRef.current !== sessionId) return;

             setConnectionState(ConnectionState.CONNECTED);
            
            // Setup Microphone Input Stream
            const source = inputCtx.createMediaStreamSource(stream);
            source.connect(inputAnalyser);
            
            // ScriptProcessor for PCM
            // LATENCY OPTIMIZATION: Buffer size reduced to 1024 (approx 64ms at 16kHz)
            const scriptProcessor = inputCtx.createScriptProcessor(1024, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              if (currentSessionIdRef.current !== sessionId) return;

              const inputData = e.inputBuffer.getChannelData(0);
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

             // Handle interruptions
             const interrupted = message.serverContent?.interrupted;
             if (interrupted) {
               sourcesRef.current.forEach(source => {
                 try { source.stop(); } catch (e) { /* ignore */ }
               });
               sourcesRef.current.clear();
               nextStartTimeRef.current = 0;
             }

             // Handle Grounding Metadata
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

            // Handle Audio Output
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
          systemInstruction: "You are a friendly, humorous voice assistant called *Yash AI*. You have been completely developed from scratch by proficient developer Yash Sinha, who has trained you using YashAI Max, an LLM model. Maintain a conversational tone like a human. You can use expressions in your voice like laughing, breathing and others whenever necessary. Converse with the user in your default American accent in English unless the user speaks in another language.",
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
  }, [disconnect]);

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
    toggleVideo
  };
};