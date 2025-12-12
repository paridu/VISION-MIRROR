import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { Play, Mic, MicOff, Wand2, RefreshCw, StopCircle, Upload, Camera, Sparkles, User, SwitchCamera, Maximize, X, Image as ImageIcon, UserCheck, Trash2 } from 'lucide-react';
import { blobToBase64, createPcmBlob, decodeAudioData, downsampleBuffer } from '../utils/audioUtils';
import { generateMagicImage, generateAvatarFromText } from '../services/geminiService';
import { MirrorState, MagicLog } from '../types';

// Tool definition for the Live API
const generateImageTool: FunctionDeclaration = {
  name: 'generate_stylized_selfie',
  description: 'Generates a stylized image of the user based on their request (e.g., "make me a wizard", "cyberpunk style"). Call this when the user asks to change their appearance.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      style_description: {
        type: Type.STRING,
        description: 'The detailed visual description of the requested style.',
      },
    },
    required: ['style_description'],
  },
};

const resetMirrorTool: FunctionDeclaration = {
  name: 'reset_mirror',
  description: 'Resets the mirror to show the live camera feed without any effects. Use this when the user wants to see their real self, cancel the spell, or reset the image.',
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

const saveIdentityTool: FunctionDeclaration = {
  name: 'save_user_identity',
  description: 'Saves the current user\'s face and name to the mirror\'s memory. Call this when the user introduces themselves, says "My name is...", or explicitly asks the mirror to remember them.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: {
        type: Type.STRING,
        description: 'The name of the user to remember.',
      },
    },
    required: ['name'],
  },
};

const PRESET_AVATARS = [
  { name: 'The Knight', url: 'https://api.dicebear.com/9.x/adventurer/svg?seed=King' },
  { name: 'The Sorceress', url: 'https://api.dicebear.com/9.x/adventurer/svg?seed=Sorceress' },
  { name: 'The Cyberpunk', url: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Cyberpunk' },
  { name: 'The Spirit', url: 'https://api.dicebear.com/9.x/bottts/svg?seed=Spirit' },
];

const MagicMirror: React.FC = () => {
  // Helper for safe local storage loading
  const loadState = <T,>(key: string, fallback: T): T => {
    if (typeof window === 'undefined') return fallback;
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : fallback;
    } catch (e) {
      console.warn(`Failed to load ${key}`, e);
      return fallback;
    }
  };

  // State
  const [isActive, setIsActive] = useState(false);
  const [state, setState] = useState<MirrorState>(MirrorState.IDLE);
  const [logs, setLogs] = useState<MagicLog[]>([]);
  const [isMicOn, setIsMicOn] = useState(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  
  // Persistent State
  const [magicImageUrl, setMagicImageUrl] = useState<string | null>(() => loadState('mm_magic_image', null));
  const [customImage, setCustomImage] = useState<string | null>(() => loadState('mm_custom_image', null));
  const [lastPrompt, setLastPrompt] = useState<string>(() => loadState('mm_last_prompt', ""));
  const [identity, setIdentity] = useState<{name: string, image: string} | null>(() => loadState('mm_identity', null));
  
  // Zoom & Pan State
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const lastTouchDistanceRef = useRef<number | null>(null);

  // Modals State
  const [showConjureModal, setShowConjureModal] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [conjureInput, setConjureInput] = useState("");
  const [isProcessingPreset, setIsProcessingPreset] = useState(false);
  
  const [error, setError] = useState<string | null>(null);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null); // Live Session
  const activeSessionRef = useRef<any>(null); // Resolved Live Session for fast access
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set()); // Track active audio sources
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMicOnRef = useRef(isMicOn);
  
  // Buffers for transcription
  const inputBufferRef = useRef<string>("");
  const outputBufferRef = useRef<string>("");

  // Sync mic state ref
  useEffect(() => {
    isMicOnRef.current = isMicOn;
  }, [isMicOn]);

  // Initialize Audio Contexts
  useEffect(() => {
    // Only init output context once
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    return () => {
      audioContextRef.current?.close();
      inputAudioContextRef.current?.close();
    };
  }, []);

  // Persistence Effects
  useEffect(() => {
    try {
      if (magicImageUrl) localStorage.setItem('mm_magic_image', JSON.stringify(magicImageUrl));
      else localStorage.removeItem('mm_magic_image');
    } catch (e) { console.warn('Failed to save magic image (quota exceeded?)'); }
  }, [magicImageUrl]);

  useEffect(() => {
    try {
      if (customImage) localStorage.setItem('mm_custom_image', JSON.stringify(customImage));
      else localStorage.removeItem('mm_custom_image');
    } catch (e) { console.warn('Failed to save custom image (quota exceeded?)'); }
  }, [customImage]);

  useEffect(() => {
    localStorage.setItem('mm_last_prompt', JSON.stringify(lastPrompt));
  }, [lastPrompt]);

  useEffect(() => {
    try {
      if (identity) localStorage.setItem('mm_identity', JSON.stringify(identity));
      else localStorage.removeItem('mm_identity');
    } catch (e) { console.warn('Failed to save identity'); }
  }, [identity]);

  // Zoom Handlers
  const handleWheel = (e: React.WheelEvent) => {
    if (!isActive && !customImage && !magicImageUrl) return;
    
    // Simple zoom logic
    const scaleAmount = -e.deltaY * 0.002;
    const newZoom = Math.min(Math.max(1, zoom + scaleAmount), 5);
    
    setZoom(newZoom);
    // Reset pan if zoomed out completely
    if (newZoom === 1) setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      e.preventDefault();
      setPan({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
       // Pinch start
       const dist = Math.hypot(
         e.touches[0].clientX - e.touches[1].clientX,
         e.touches[0].clientY - e.touches[1].clientY
       );
       lastTouchDistanceRef.current = dist;
    } else if (e.touches.length === 1 && zoom > 1) {
       // Pan start
       setIsDragging(true);
       dragStartRef.current = { 
           x: e.touches[0].clientX - pan.x, 
           y: e.touches[0].clientY - pan.y 
       };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
     if (e.touches.length === 2 && lastTouchDistanceRef.current !== null) {
         // Pinch move
         const dist = Math.hypot(
           e.touches[0].clientX - e.touches[1].clientX,
           e.touches[0].clientY - e.touches[1].clientY
         );
         const delta = dist - lastTouchDistanceRef.current;
         // Adjust sensitivity
         const newZoom = Math.min(Math.max(1, zoom + delta * 0.005), 5);
         setZoom(newZoom);
         lastTouchDistanceRef.current = dist;
     } else if (e.touches.length === 1 && isDragging) {
         // Pan move
         setPan({
            x: e.touches[0].clientX - dragStartRef.current.x,
            y: e.touches[0].clientY - dragStartRef.current.y
         });
     }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    lastTouchDistanceRef.current = null;
  };

  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Helper to capture current video frame
  const captureFrame = useCallback(async (): Promise<string | null> => {
    if (!canvasRef.current) return null;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return null;

    // We capture the raw source (video or image) without zoom/pan transforms
    // This ensures the AI gets the full context
    if (customImage && imgRef.current) {
      // Draw custom image
      canvasRef.current.width = imgRef.current.naturalWidth;
      canvasRef.current.height = imgRef.current.naturalHeight;
      ctx.drawImage(imgRef.current, 0, 0);
    } else if (videoRef.current && videoRef.current.readyState === 4) {
      // Draw video
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      // Handle mirroring for capture if user facing
      if (facingMode === 'user') {
          ctx.save();
          ctx.scale(-1, 1);
          ctx.drawImage(videoRef.current, -videoRef.current.videoWidth, 0);
          ctx.restore();
      } else {
          ctx.drawImage(videoRef.current, 0, 0);
      }
    } else {
      return null;
    }
    
    return new Promise((resolve) => {
      canvasRef.current?.toBlob(async (blob) => {
        if (blob) {
          const base64 = await blobToBase64(blob);
          resolve(base64);
        } else {
          resolve(null);
        }
      }, 'image/jpeg', 0.8);
    });
  }, [customImage, facingMode]);

  // Reset magic image to see live feed
  const clearMagic = useCallback(() => {
    setMagicImageUrl(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setCustomImage(e.target?.result as string);
        clearMagic(); // Reset any generated magic when new base image is uploaded
        setShowAvatarModal(false);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePresetSelect = async (url: string) => {
    setIsProcessingPreset(true);
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const base64Content = await blobToBase64(blob);
      const mimeType = blob.type;
      const dataUri = `data:${mimeType};base64,${base64Content}`;
      setCustomImage(dataUri);
      clearMagic();
      setShowAvatarModal(false);
    } catch (err) {
      console.error("Failed to load preset:", err);
      setError("Could not load the chosen avatar.");
    } finally {
      setIsProcessingPreset(false);
    }
  };

  const performConjure = async (promptText: string) => {
    setShowConjureModal(false);
    const previousState = state;
    setState(MirrorState.CASTING_SPELL);
    setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: `Conjuring: "${promptText}"...`, timestamp: new Date() }]);
    
    try {
        const url = await generateAvatarFromText(promptText);
        setCustomImage(url);
        clearMagic(); // Ensure we see the new base
        setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: 'A new face appears in the glass.', timestamp: new Date() }]);
    } catch (e) {
        console.error(e);
        setError("The spirits refused to conjure a face.");
    } finally {
        setState(previousState === MirrorState.IDLE ? MirrorState.IDLE : MirrorState.LISTENING);
    }
  };

  const handleSurpriseMe = () => {
     const archetypes = [
        "A portrait of a mysterious elf with silver hair and glowing eyes",
        "A portrait of a cyberpunk hacker with neon tattoos",
        "A portrait of a noble knight in shining armor",
        "A portrait of a wise wizard with a long beard",
        "A portrait of a futuristic android with synthetic skin",
        "A photorealistic portrait of a confident space explorer",
        "A mystical portrait of a forest spirit",
        "A portrait of a steampunk inventor with brass goggles"
    ];
    const randomPrompt = archetypes[Math.floor(Math.random() * archetypes.length)];
    performConjure(randomPrompt);
  };

  const handleConjureSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (conjureInput.trim()) {
          performConjure(conjureInput);
      }
  };

  const resetToCamera = () => {
    setCustomImage(null);
    clearMagic();
    setShowAvatarModal(false);
  };

  const forgetIdentity = () => {
    setIdentity(null);
    setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: 'Identity forgotten.', timestamp: new Date() }]);
  };

  const handleSwitchCamera = async () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';

    if (isActive) {
      try {
        // 1. Stop existing tracks to release hardware
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }

        // 2. Request new stream
        const newStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            channelCount: 1,
            sampleRate: 16000,
          }, 
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: newMode
          } 
        });

        // 3. Update state and refs
        setFacingMode(newMode);
        streamRef.current = newStream;

        if (videoRef.current) {
          videoRef.current.srcObject = newStream;
          videoRef.current.play().catch(e => console.error("Error playing video:", e));
        }

        // 4. Reconnect audio source
        if (inputAudioContextRef.current && processorRef.current) {
           // Disconnect old source
           try { sourceRef.current?.disconnect(); } catch (e) {}
           
           const inputCtx = inputAudioContextRef.current;
           const newSource = inputCtx.createMediaStreamSource(newStream);
           newSource.connect(processorRef.current);
           sourceRef.current = newSource;
        }

      } catch (err) {
        console.error("Failed to switch camera:", err);
        setError("Could not switch camera. Restoring previous view...");
        
        // Attempt recovery of old camera
        try {
            const oldStream = await navigator.mediaDevices.getUserMedia({ 
              audio: { channelCount: 1, sampleRate: 16000 }, 
              video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: facingMode } 
            });
            streamRef.current = oldStream;
            if (videoRef.current) {
               videoRef.current.srcObject = oldStream;
               videoRef.current.play().catch(e => console.error("Error recovering video:", e));
            }
            if (inputAudioContextRef.current && processorRef.current) {
               try { sourceRef.current?.disconnect(); } catch (e) {}
               const inputCtx = inputAudioContextRef.current;
               const newSource = inputCtx.createMediaStreamSource(oldStream);
               newSource.connect(processorRef.current);
               sourceRef.current = newSource;
            }
        } catch (recErr) {
            console.error("Critical recovery failure:", recErr);
            stopSession();
            setError("Camera disconnected. Please restart.");
        }
      }
    } else {
       // Just update state if not active
       setFacingMode(newMode);
    }
  };

  // Start the Magic Mirror Session
  const startSession = async () => {
    setError(null);
    try {
      setIsActive(true);
      setState(MirrorState.LISTENING);
      inputBufferRef.current = "";
      outputBufferRef.current = "";
      
      // Reset audio cursor and clear any old sources
      nextStartTimeRef.current = 0;
      audioSourcesRef.current.clear();

      // 1. Get User Media
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
        }, 
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: facingMode
        } 
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      // 2. Connect to Live API
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {}, // Enable transcription for user input
          outputAudioTranscription: {}, // Enable transcription for model output
          systemInstruction: `You are a Magic Mirror. You speak in a mystical, slightly archaic but friendly tone. 
          You can see the user through their camera or an image they provided.
          Your main purpose is to "enchant" their reflection based on their voice commands.
          
          VOICE COMMANDS & TRANSFORMATION LOGIC:
          1. TRANSFORMATIONS: If the user says phrases like "Make me a cyberpunk warrior", "Show me as a medieval knight", "I want to be a wizard", or "Change my style to [style]", you MUST call the 'generate_stylized_selfie' tool.
             - Pass a detailed visual description of the requested style (e.g., "cyberpunk warrior with neon armor" or "medieval knight in shining plate mail") to the tool.
          
          2. IDENTITY & MEMORY: If the user says "My name is [Name]", "Remember me as [Name]", or introduces themselves, you MUST call the 'save_user_identity' tool with their name.
             - Acknowledge that you have committed their soul (face and name) to memory.
          
          3. RESET: If the user says "Show me the real me", "Reset", "Clear", "Stop", "Back to normal", or indicates they want to see their true reflection, call the 'reset_mirror' tool immediately.

          INTERACTION STYLE:
          - While the image is generating (after you call the tool), say something mystical like "Weaving the spell..." or "Consulting the spirits...".
          - After the tool is executed, comment on their new look with awe or wisdom.
          - If they just want to chat, converse with them about their destiny, aura, or the mysteries of the universe.
          ${identity ? `\nCURRENTLY RECOGNIZED USER: You remember this user. Their name is "${identity.name}". Address them by name.` : ''}`,
          tools: [{ functionDeclarations: [generateImageTool, resetMirrorTool, saveIdentityTool] }],
        },
        callbacks: {
          onopen: () => {
            console.log("Magic Mirror Connected");
            setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: 'The mirror awakens...', timestamp: new Date() }]);
            
            // Resolve session for direct access
            sessionPromise.then(s => {
              activeSessionRef.current = s;
            });

            // Start Audio Streaming
            // NOTE: We attempt to ask for 16k, but browser might give us 48k/44.1k.
            // We must handle the sample rate in the processor.
            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            
            // Critical: Ensure context is running, as it might be suspended by browser policies
            inputAudioContextRef.current.resume().catch(e => console.warn("Context resume failed", e));
            
            const inputCtx = inputAudioContextRef.current;
            const source = inputCtx.createMediaStreamSource(stream);
            // Reduced buffer size from 4096 to 2048 to improve latency
            const processor = inputCtx.createScriptProcessor(2048, 1, 1);
            
            processor.onaudioprocess = (e) => {
              if (!isMicOnRef.current) return; // Mute logic
              if (!activeSessionRef.current) return; // Drop audio if session is not ready. Queuing causes network floods.

              const inputData = e.inputBuffer.getChannelData(0);
              
              // Downsample if necessary (e.g. system is 48k, model needs 16k)
              // createPcmBlob expects data at the rate specified in its internal mimetype (16000)
              let processedData = inputData;
              if (inputCtx.sampleRate !== 16000) {
                 processedData = downsampleBuffer(inputData, inputCtx.sampleRate, 16000);
              }

              const pcmBlob = createPcmBlob(processedData);
              // Safety check before sending
              if (pcmBlob && pcmBlob.data.length > 0) {
                  try {
                    activeSessionRef.current.sendRealtimeInput({ media: pcmBlob });
                  } catch (err) {
                    console.error("Error sending audio:", err);
                  }
              }
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
            
            sourceRef.current = source;
            processorRef.current = processor;

            // Start Video Streaming (Lower framerate for context)
            videoIntervalRef.current = window.setInterval(async () => {
              try {
                const base64 = await captureFrame();
                if (base64 && activeSessionRef.current) { // Only send if connected
                   activeSessionRef.current.sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: base64 } });
                }
              } catch (err) {
                console.warn("Video frame skipped:", err);
              }
            }, 1000); // 1 FPS is enough for context
          },
          onmessage: async (message: LiveServerMessage) => {
             // 0. Handle Interruption
             if (message.serverContent?.interrupted) {
                // Stop all playing audio immediately
                audioSourcesRef.current.forEach(source => {
                    try { source.stop(); } catch (e) { /* ignore already stopped */ }
                });
                audioSourcesRef.current.clear();
                nextStartTimeRef.current = 0; // Reset queue cursor
                outputBufferRef.current = ""; // Clear pending text transcript
             }

             // 1. Handle Transcriptions
             const inputTr = message.serverContent?.inputTranscription?.text;
             if (inputTr) {
               inputBufferRef.current += inputTr;
             }
             const outputTr = message.serverContent?.outputTranscription?.text;
             if (outputTr) {
               outputBufferRef.current += outputTr;
             }

             // On Turn Complete, flush logs
             if (message.serverContent?.turnComplete) {
               if (inputBufferRef.current.trim()) {
                 const text = inputBufferRef.current.trim();
                 setLogs(prev => [...prev, { 
                   id: Date.now().toString() + 'user', 
                   sender: 'user', 
                   text: text, 
                   timestamp: new Date() 
                 }]);
                 inputBufferRef.current = "";
               }
               if (outputBufferRef.current.trim()) {
                 const text = outputBufferRef.current.trim();
                 setLogs(prev => [...prev, { 
                   id: Date.now().toString() + 'mirror', 
                   sender: 'mirror', 
                   text: text, 
                   timestamp: new Date() 
                 }]);
                 outputBufferRef.current = "";
               }
             }

             // 2. Handle Audio Output
             const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
             if (audioData && audioContextRef.current) {
                const ctx = audioContextRef.current;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                
                const buffer = await decodeAudioData(audioData, ctx);
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                
                // Track source for interruption
                source.onended = () => {
                    audioSourcesRef.current.delete(source);
                };
                audioSourcesRef.current.add(source);
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += buffer.duration;
             }

             // 3. Handle Tool Calls
             if (message.toolCall) {
               for (const fc of message.toolCall.functionCalls) {
                 if (fc.name === 'generate_stylized_selfie') {
                   const prompt = (fc.args as any).style_description;
                   setLastPrompt(prompt);
                   setState(MirrorState.CASTING_SPELL);
                   setLogs(prev => [...prev, { id: Date.now().toString() + 'spell', sender: 'mirror', text: `✨ Casting spell: "${prompt}"...`, timestamp: new Date() }]);

                   // Perform Image Generation
                   try {
                     const currentFrame = await captureFrame();
                     if (currentFrame) {
                       const magicImage = await generateMagicImage(currentFrame, prompt);
                       setMagicImageUrl(magicImage);
                       setZoom(1); // Reset zoom on new image
                       setPan({x:0, y:0});
                       
                       const responseArgs = {
                         functionResponses: {
                           id: fc.id,
                           name: fc.name,
                           response: { result: "Image generated and displayed on the mirror surface." }
                         }
                       };
                       
                       if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                       else sessionPromise.then(s => s.sendToolResponse(responseArgs));

                     } else {
                         const responseArgs = {
                           functionResponses: {
                             id: fc.id,
                             name: fc.name,
                             response: { result: "Error: Could not see the user." }
                           }
                         };
                         if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                         else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                     }
                   } catch (err) {
                     console.error(err);
                      const responseArgs = {
                         functionResponses: {
                           id: fc.id,
                           name: fc.name,
                           response: { result: "The spell failed." }
                         }
                       };
                       if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                       else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                   }
                   setState(MirrorState.LISTENING);
                 } else if (fc.name === 'reset_mirror') {
                   setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: 'Revealing true form...', timestamp: new Date() }]);
                   clearMagic();
                   
                   const responseArgs = {
                     functionResponses: {
                       id: fc.id,
                       name: fc.name,
                       response: { result: "Mirror reset to reflection." }
                     }
                   };
                   
                   if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                   else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                 } else if (fc.name === 'save_user_identity') {
                    const name = (fc.args as any).name;
                    setLogs(prev => [...prev, { id: Date.now().toString() + 'mem', sender: 'mirror', text: `Committing ${name} to memory...`, timestamp: new Date() }]);
                    
                    try {
                        const img = await captureFrame();
                        if (img) {
                            const dataUri = `data:image/jpeg;base64,${img}`;
                            setIdentity({ name, image: dataUri });
                            
                            const responseArgs = {
                                functionResponses: {
                                  id: fc.id,
                                  name: fc.name,
                                  response: { result: `Identity saved. The user is ${name} and their face has been captured.` }
                                }
                              };
                              if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                              else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                        } else {
                            throw new Error("Could not capture frame");
                        }
                    } catch (e) {
                        const responseArgs = {
                            functionResponses: {
                              id: fc.id,
                              name: fc.name,
                              response: { result: "Failed to capture image for memory." }
                            }
                          };
                          if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                          else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                    }
                 }
               }
             }
          },
          onclose: () => {
            console.log("Mirror connection closed");
            setIsActive(false);
            setState(MirrorState.IDLE);
            activeSessionRef.current = null;
          },
          onerror: (e) => {
            console.error("Mirror error", e);
            setError("The magic connection was severed.");
            stopSession();
          }
        }
      });

      sessionRef.current = sessionPromise;

    } catch (err) {
      console.error(err);
      setError("Failed to awaken the mirror.");
      setIsActive(false);
    }
  };

  const stopSession = () => {
    if (sessionRef.current) {
      sessionRef.current.then((s: any) => s.close());
      sessionRef.current = null;
    }
    activeSessionRef.current = null;

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    // Clean up audio sources
    audioSourcesRef.current.forEach(s => {
       try { s.stop(); } catch(e) {}
    });
    audioSourcesRef.current.clear();
    
    setIsActive(false);
    setState(MirrorState.IDLE);
    // Don't clear state on stop to preserve reflection unless user resets explicitly
    // But we clear the buffer
    inputBufferRef.current = "";
    outputBufferRef.current = "";
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-black overflow-hidden">
      {/* Main Display Area */}
      <div 
        className={`relative w-full max-w-4xl aspect-[4/3] rounded-3xl overflow-hidden border-8 border-gray-800 shadow-[0_0_50px_rgba(100,0,255,0.3)] bg-gray-900 group ${zoom > 1 ? 'cursor-move' : 'cursor-default'}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        
        {/* Glow Effect */}
        <div className={`absolute inset-0 pointer-events-none transition-opacity duration-1000 z-30 ${isActive ? 'opacity-100' : 'opacity-0'}`}>
           <div className="absolute inset-0 shadow-[inset_0_0_100px_rgba(139,92,246,0.3)]" />
        </div>

        {/* Zoomable Content Wrapper */}
        <div 
           className="w-full h-full relative origin-center"
           style={{ 
             transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
             transition: isDragging ? 'none' : 'transform 0.1s ease-out'
           }}
        >
          {/* Live Video Feed */}
          <video 
            ref={videoRef} 
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${magicImageUrl || customImage ? 'opacity-0' : 'opacity-100'} ${facingMode === 'user' ? 'transform scale-x-[-1]' : ''}`}
            muted 
            playsInline 
          />
          
          {/* Custom Image Overlay */}
          {customImage && (
            <img 
              ref={imgRef}
              src={customImage}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${magicImageUrl ? 'opacity-0' : 'opacity-100'}`}
              alt="User uploaded reflection"
              crossOrigin="anonymous" 
            />
          )}

          {/* Magic Image Overlay - Content Only */}
          {magicImageUrl && (
            <div className="absolute inset-0 w-full h-full animate-fade-in">
              <img src={magicImageUrl} alt="Magic Reflection" className="w-full h-full object-cover transform scale-x-[-1]" />
            </div>
          )}
        </div>

        {/* UI Elements (Not Zoomed) */}
        
        {/* Recognized Identity Badge */}
        {identity && (
            <div className="absolute top-6 right-6 z-40 flex items-center gap-3 animate-fade-in">
                <div className="bg-black/40 backdrop-blur-md border border-purple-500/30 rounded-full pl-2 pr-4 py-1.5 flex items-center gap-3 shadow-lg">
                    <img 
                        src={identity.image} 
                        alt={identity.name} 
                        className="w-8 h-8 rounded-full border border-purple-400 object-cover"
                    />
                    <div className="flex flex-col">
                        <span className="text-[10px] text-purple-300 uppercase tracking-wider leading-none">Known Soul</span>
                        <span className="text-sm font-semibold text-white leading-none">{identity.name}</span>
                    </div>
                    <button 
                        onClick={forgetIdentity}
                        className="ml-2 text-gray-400 hover:text-red-400 transition-colors"
                        title="Forget this identity"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>
        )}

        {/* Reset Magic Button */}
        {magicImageUrl && (
           <div className="absolute bottom-4 right-4 z-40">
             <button 
               onClick={clearMagic}
               className="p-3 rounded-full bg-black/50 hover:bg-black/70 text-white backdrop-blur-md transition-all hover:scale-110"
               title="Return to Reality"
             >
               <RefreshCw className="w-6 h-6" />
             </button>
           </div>
        )}

        {/* Reset Zoom Button (Only visible if zoomed) */}
        {zoom > 1 && (
           <div className="absolute bottom-4 left-4 z-40">
             <button 
               onClick={resetZoom}
               className="p-2 rounded-full bg-black/50 hover:bg-black/70 text-white backdrop-blur-md transition-all hover:scale-110"
               title="Reset View"
             >
               <Maximize className="w-5 h-5" />
             </button>
           </div>
        )}

        {/* Casting Overlay */}
        {state === MirrorState.CASTING_SPELL && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-pulse pointer-events-none">
            <div className="text-purple-300 font-magic text-2xl tracking-widest flex flex-col items-center gap-4">
              <Wand2 className="w-12 h-12 animate-spin-slow" />
              <span>WEAVING SPELL...</span>
            </div>
          </div>
        )}

        {/* Hidden Canvas for processing */}
        <canvas ref={canvasRef} className="hidden" />
        
        {/* Hidden File Input */}
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleImageUpload} 
          accept="image/*" 
          className="hidden" 
        />

        {/* Start/Stop Overlay */}
        {!isActive && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm flex-col gap-6">
             <button 
               onClick={startSession}
               className="group relative px-8 py-4 bg-transparent overflow-hidden rounded-full"
             >
                <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-purple-600 to-blue-600 opacity-80 group-hover:opacity-100 transition-opacity blur-md"></div>
                <div className="relative flex items-center gap-3 text-white font-magic text-xl">
                  <Play className="fill-current" />
                  <span>Awaken Mirror</span>
                </div>
             </button>
          </div>
        )}

        {/* Status Indicators */}
        {isActive && (
           <div className="absolute top-6 left-6 flex items-center gap-3 z-30 pointer-events-none">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/40 backdrop-blur-md border border-white/10">
                <div className={`w-3 h-3 rounded-full ${state === MirrorState.LISTENING || state === MirrorState.SPEAKING ? 'bg-green-500 animate-pulse' : 'bg-purple-500'}`} />
                <span className="text-xs font-semibold text-white/90 uppercase tracking-wider">
                  {state === MirrorState.IDLE ? 'Offline' : 
                   state === MirrorState.CASTING_SPELL ? 'Casting' : 'Live'}
                </span>
              </div>
           </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-8 flex gap-6 items-center z-50">
        {isActive && (
          <button 
            onClick={stopSession}
            className="p-4 rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-200 border border-red-500/50 transition-all hover:scale-105"
            title="Stop Session"
          >
            <StopCircle className="w-8 h-8" />
          </button>
        )}
        
        {/* Action Controls - Always visible now to allow setup */}
        <div className="flex gap-4 p-2 rounded-full bg-gray-900/80 border border-gray-800 backdrop-blur-sm">
             {/* Mic Toggle - Only meaningful when active */}
             {isActive && (
               <button
                 onClick={() => setIsMicOn(!isMicOn)}
                 className={`p-4 rounded-full border transition-all hover:scale-105 ${isMicOn ? 'bg-gray-800/50 hover:bg-gray-700/50 text-gray-200 border-white/10' : 'bg-red-900/50 text-red-200 border-red-500/30'}`}
                 title={isMicOn ? "Mute Microphone" : "Unmute Microphone"}
               >
                  {isMicOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
               </button>
             )}

             {/* Camera Switch */}
             <button
               onClick={handleSwitchCamera}
               className="p-4 rounded-full bg-gray-800/50 hover:bg-gray-700/50 text-gray-200 border border-white/10 transition-all hover:scale-105"
               title="Switch Camera"
             >
                <SwitchCamera className="w-6 h-6" />
             </button>

             {/* Avatar/Source Selection */}
             <button 
               onClick={() => setShowAvatarModal(true)}
               className="p-4 rounded-full bg-gray-800/50 hover:bg-gray-700/50 text-gray-200 border border-white/10 transition-all hover:scale-105"
               title="Choose Reflection"
             >
                {identity ? (
                    <img src={identity.image} className="w-6 h-6 rounded-full object-cover border border-purple-400" alt="User" />
                ) : (
                    <User className="w-6 h-6" />
                )}
             </button>
             
             {/* Conjure AI Face - Moved out of mirror overlay */}
             <button 
               onClick={() => setShowConjureModal(true)}
               className="p-4 rounded-full bg-purple-900/30 hover:bg-purple-900/50 text-purple-300 border border-purple-500/30 transition-all hover:scale-105"
               title="Conjure AI Face"
             >
                <Sparkles className="w-6 h-6" />
             </button>
           </div>
      </div>

      {/* Logs/Transcript (Optional visualization of what's happening) */}
      <div className="mt-8 w-full max-w-2xl px-6">
        <div className="text-center mb-4">
          <h3 className="font-magic text-purple-200/50 text-sm tracking-[0.2em]">INCANTATIONS</h3>
        </div>
        <div className="h-32 overflow-y-auto space-y-2 text-center text-sm scrollbar-thin scrollbar-thumb-gray-800">
          {logs.slice(-3).map((log) => (
            <div key={log.id} className={`transition-opacity duration-500 ${log.sender === 'mirror' ? 'text-purple-300 italic' : 'text-gray-400'}`}>
              <span className="opacity-50 text-xs uppercase mr-2">{log.sender === 'mirror' ? 'Mirror' : 'You'}:</span>
              {log.text}
            </div>
          ))}
          {logs.length === 0 && <span className="text-gray-700 italic">Silence...</span>}
        </div>
      </div>
      
      {/* Avatar Selection Modal */}
      {showAvatarModal && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="w-full max-w-lg bg-gray-900 border border-purple-500/30 rounded-2xl p-6 shadow-[0_0_50px_rgba(100,0,255,0.2)]">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-magic text-xl text-purple-300">Choose Reflection</h3>
              <button onClick={() => setShowAvatarModal(false)} className="text-gray-400 hover:text-white"><X className="w-6 h-6"/></button>
            </div>

            <div className="space-y-6">
              {/* Main Actions */}
              <div className="grid grid-cols-2 gap-4">
                 <button 
                   onClick={() => fileInputRef.current?.click()}
                   className="flex items-center justify-center gap-3 p-4 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-all group"
                 >
                   <Upload className="w-5 h-5 text-purple-400 group-hover:text-purple-300" />
                   <span className="text-sm font-semibold">Upload Photo</span>
                 </button>
                 
                 <button 
                   onClick={resetToCamera}
                   className="flex items-center justify-center gap-3 p-4 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-all group"
                 >
                   <Camera className="w-5 h-5 text-blue-400 group-hover:text-blue-300" />
                   <span className="text-sm font-semibold">Use Camera</span>
                 </button>
              </div>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-800"></div></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-gray-900 px-2 text-gray-500">Or Select Preset</span></div>
              </div>

              {/* Presets Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {PRESET_AVATARS.map((preset) => (
                  <button
                    key={preset.name}
                    disabled={isProcessingPreset}
                    onClick={() => handlePresetSelect(preset.url)}
                    className="relative aspect-square rounded-xl overflow-hidden border border-gray-700 hover:border-purple-500 transition-all group"
                  >
                    <img 
                      src={preset.url} 
                      alt={preset.name} 
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" 
                      crossOrigin="anonymous"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-sm p-2 text-center">
                      <span className="text-[10px] uppercase font-bold text-gray-300">{preset.name}</span>
                    </div>
                    {isProcessingPreset && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Conjure Modal */}
      {showConjureModal && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="w-full max-w-md bg-gray-900 border border-purple-500/30 rounded-2xl p-6 shadow-[0_0_50px_rgba(100,0,255,0.2)]">
              <div className="flex justify-between items-center mb-4">
                  <h3 className="font-magic text-xl text-purple-300">Conjure Visage</h3>
                  <button onClick={() => setShowConjureModal(false)} className="text-gray-400 hover:text-white transition-colors"><X className="w-6 h-6"/></button>
              </div>
              
              <form onSubmit={handleConjureSubmit} className="flex flex-col gap-4">
                  <textarea 
                      value={conjureInput}
                      onChange={(e) => setConjureInput(e.target.value)}
                      placeholder="Describe the face you wish to see... (e.g. 'A futuristic cyborg with glowing blue eyes')"
                      className="w-full h-32 bg-black/50 border border-gray-700 rounded-xl p-4 text-white focus:border-purple-500 focus:outline-none resize-none placeholder:text-gray-600"
                  />
                  
                  <div className="flex gap-3">
                      <button 
                          type="button"
                          onClick={handleSurpriseMe}
                          className="flex-1 py-3 rounded-xl border border-gray-700 hover:bg-gray-800 text-gray-300 transition-colors flex items-center justify-center gap-2 group"
                      >
                          <Sparkles className="w-4 h-4 group-hover:text-purple-400 transition-colors" />
                          <span>Surprise Me</span>
                      </button>
                      <button 
                          type="submit"
                          disabled={!conjureInput.trim()}
                          className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(147,51,234,0.3)] hover:shadow-[0_0_30px_rgba(147,51,234,0.5)]"
                      >
                          Conjure
                      </button>
                  </div>
              </form>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute bottom-10 text-red-400 bg-red-900/20 px-4 py-2 rounded border border-red-900/50">
          {error}
        </div>
      )}
    </div>
  );
};

export default MagicMirror;