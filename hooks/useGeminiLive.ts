import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState, GroundingMetadata } from '../types';
import { createPcmBlob, base64ToBytes, decodeAudioData } from '../utils/audio-utils';

export const useGeminiLive = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [groundingMetadata, setGroundingMetadata] = useState<GroundingMetadata | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  
  // Audio Contexts and Nodes
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Session Management
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const currentSessionIdRef = useRef<string>('');
  const groundingTimeoutRef = useRef<any>(null);

  const disconnect = useCallback(async () => {
    const sessionId = currentSessionIdRef.current;
    console.log(`[${sessionId}] Disconnecting...`);

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
  }, []);

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
      // Ensure any previous connection is fully cleaned up
      await disconnect();
      
      setConnectionState(ConnectionState.CONNECTING);
      setError(null);
      setGroundingMetadata(null);
      setIsMuted(false);

      // 1. Setup Audio Contexts
      // Input: 16kHz for Gemini compatibility
      // We use a try-catch for context creation as it might fail on some browsers if too many are open
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

      // 2. Setup Analysers
      const inputAnalyser = inputCtx.createAnalyser();
      inputAnalyser.fftSize = 256;
      inputAnalyser.smoothingTimeConstant = 0.5; // Smoother visualization
      inputAnalyserRef.current = inputAnalyser;

      const outputAnalyser = outputCtx.createAnalyser();
      outputAnalyser.fftSize = 256;
      outputAnalyser.smoothingTimeConstant = 0.5;
      outputAnalyserRef.current = outputAnalyser;

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
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
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
               // Clear existing timer if any
               if (groundingTimeoutRef.current) {
                 clearTimeout(groundingTimeoutRef.current);
               }
               
               // Set new metadata
               setGroundingMetadata(grounding);
               
               // Set timer to clear metadata after 3 seconds
               groundingTimeoutRef.current = setTimeout(() => {
                 setGroundingMetadata(null);
               }, 3000);
             }

            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
               const ctx = outputAudioContextRef.current;
               if (!ctx) return;

               // Sync timing
               nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);

               const audioBuffer = await decodeAudioData(
                 base64ToBytes(base64Audio),
                 ctx,
                 24000,
                 1
               );

               const source = ctx.createBufferSource();
               source.buffer = audioBuffer;
               source.connect(outputAnalyser);
               outputAnalyser.connect(ctx.destination);

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
          systemInstruction: "You are a friendly, humorous voice assistant called *Yash AI* (pronounced as *Yuhsh AI*). You have been completely developed from scratch by proficient developer Yash (pronounced as *Yuhsh*) Sinha, who has trained you using YashAI Max, an LLM model. Maintain a conversational tone like a human. You can laugh, breathe, go fast or slow whenever necessary. Converse with the user in your default American accent in English unless the user speaks in another language.",
          thinkingConfig: { thinkingBudget: 0 },
          tools: [{ googleSearch: {} }] // Enable Google Search Grounding
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

  // Cleanup on unmount
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
    toggleMute
  };
};
