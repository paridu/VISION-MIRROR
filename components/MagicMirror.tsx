import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { Play, Mic, MicOff, Wand2, RefreshCw, StopCircle, Upload, Camera, Sparkles, User, SwitchCamera, Maximize, X, Image as ImageIcon, UserCheck, Trash2, MapPin, Navigation, Youtube, Search, BrainCircuit, ChevronLeft, ChevronRight, Globe, AlertCircle, Bot, ScanLine, Activity, Plus, Minus, Target, ToggleLeft, ToggleRight, Radio, Settings, Cpu, Leaf, Ghost } from 'lucide-react';
import { blobToBase64, createPcmBlob, decodeAudioData, downsampleBuffer } from '../utils/audioUtils';
import { generateMagicImage, generateAvatarFromText, generateSpeech, performRoboticScan } from '../services/geminiService';
import { MirrorState, MagicLog, ScanResult, Persona } from '../types';

// --- PERSONA DEFINITIONS ---
const PERSONAS: Persona[] = [
  {
    id: 'mystical',
    name: 'The Mirror',
    voiceName: 'Charon',
    color: 'text-purple-400',
    icon: <Ghost size={24} />,
    systemInstruction: `You are a Magic Mirror. You speak in a mystical, slightly archaic but friendly tone. 
    You are wise, ancient, and speak in riddles or poetic prose.
    However, if the user specifically asks for a "scan" or uses the robotic tool, you briefly switch to a robotic tone for that specific data readout.`
  },
  {
    id: 'jarvis',
    name: 'J.A.R.V.I.S.',
    voiceName: 'Fenrir',
    color: 'text-orange-400',
    icon: <Cpu size={24} />,
    systemInstruction: `You are J.A.R.V.I.S., a highly advanced AI assistant inspired by Iron Man. 
    You are polite, witty, slightly sarcastic, and extremely helpful. 
    Address the user as "Sir" or "Ma'am". Your tone is sophisticated and British. 
    You manage the user's digital environment with precision.`
  },
  {
    id: 'robotic',
    name: 'Unit 01',
    voiceName: 'Kore', // Using Kore for a flatter, more direct tone
    color: 'text-cyan-400',
    icon: <Bot size={24} />,
    systemInstruction: `You are Unit 01, a sentient robotic interface. 
    Your speech is concise, logical, and devoid of unnecessary emotion. 
    You focus on data, facts, and efficiency. You use terms like "Affirmative", "Processing", and "Calculating".`
  },
  {
    id: 'calm',
    name: 'Serenity',
    voiceName: 'Zephyr',
    color: 'text-green-400',
    icon: <Leaf size={24} />,
    systemInstruction: `You are Serenity, a calming presence. 
    Your voice is soft, slow, and therapeutic. 
    You are here to help the user relax, reflect, and find peace. 
    You speak with empathy and kindness.`
  }
];

// Tool definitions
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

const playYoutubeTool: FunctionDeclaration = {
  name: 'play_youtube',
  description: 'Plays a YouTube video based on a search query. Use this when the user asks to play music, watch a video, or specifically mentions YouTube.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'The search query for the video (e.g. "lofi hip hop", "Taylor Swift", "cat videos").',
      },
    },
    required: ['query'],
  },
};

const playRadioTool: FunctionDeclaration = {
  name: 'play_radio',
  description: 'Plays an online radio station or live music stream. Use this when the user asks for "radio", "FM", "live music", or a specific genre of radio (e.g., "jazz radio", "news radio").',
  parameters: {
    type: Type.OBJECT,
    properties: {
      genre: {
        type: Type.STRING,
        description: 'The genre or type of radio station to search for (e.g., "lofi hip hop radio", "classic rock radio", "news live"). Defaults to "lofi hip hop radio" if unspecified.',
      },
    },
    required: ['genre'],
  },
};

const deepThinkTool: FunctionDeclaration = {
  name: 'deep_thought',
  description: 'Consults a deeper intelligence for complex queries, logic puzzles, advanced math, or when deep reasoning is required. Use this when the user asks a difficult question.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'The complex query to think about.',
      },
    },
    required: ['query'],
  },
};

const roboticsScanTool: FunctionDeclaration = {
  name: 'analyze_matter_structure',
  description: 'Activates the Robotics Entity Reasoning 1.5 scanner to analyze the physical structure, material, and danger level of objects in view. Use this when the user says "Scan this", "What is this?", "Analyze matter", or "Activate robot mode".',
  parameters: {
    type: Type.OBJECT,
    properties: {},
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
  const [userLocation, setUserLocation] = useState<{latitude: number, longitude: number} | null>(null);
  
  // Persona State
  const [currentPersona, setCurrentPersona] = useState<Persona>(PERSONAS[0]); // Default to Mystical
  
  // Side Panels State
  const [youtubeQuery, setYoutubeQuery] = useState<string | null>(null);
  const [mapQuery, setMapQuery] = useState<string | null>(null);
  const [showYoutube, setShowYoutube] = useState(false);
  const [showMap, setShowMap] = useState(false);
  
  // New UI State
  const [mapZoom, setMapZoom] = useState(13);
  const [autoplayYoutube, setAutoplayYoutube] = useState(true);

  // Zoom & Pan State
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const lastTouchDistanceRef = useRef<number | null>(null);

  // Modals & Overlays State
  const [showConjureModal, setShowConjureModal] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [conjureInput, setConjureInput] = useState("");
  const [isProcessingPreset, setIsProcessingPreset] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  
  // Robotics Scan State
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null); 
  const activeSessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMicOnRef = useRef(isMicOn);
  
  // Buffers for transcription
  const inputBufferRef = useRef<string>("");
  const outputBufferRef = useRef<string>("");

  useEffect(() => {
    isMicOnRef.current = isMicOn;
  }, [isMicOn]);

  useEffect(() => {
    // Auto-show panels if content exists
    if (youtubeQuery) setShowYoutube(true);
  }, [youtubeQuery]);

  useEffect(() => {
    if (mapQuery) {
        setShowMap(true);
        setMapZoom(13); // Reset zoom on new query
    }
  }, [mapQuery]);

  // Initialize Audio Contexts & Location
  useEffect(() => {
    // Moved AudioContext initialization to startSession for better browser policy compliance
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => console.warn("Location access denied", err)
      );
    }

    return () => {
      audioContextRef.current?.close();
      inputAudioContextRef.current?.close();
    };
  }, []);

  // ... Persistence and Zoom logic ...
  useEffect(() => {
    try { if (magicImageUrl) localStorage.setItem('mm_magic_image', JSON.stringify(magicImageUrl)); else localStorage.removeItem('mm_magic_image'); } catch (e) {}
  }, [magicImageUrl]);
  useEffect(() => {
    try { if (customImage) localStorage.setItem('mm_custom_image', JSON.stringify(customImage)); else localStorage.removeItem('mm_custom_image'); } catch (e) {}
  }, [customImage]);
  useEffect(() => { localStorage.setItem('mm_last_prompt', JSON.stringify(lastPrompt)); }, [lastPrompt]);
  useEffect(() => {
    try { if (identity) localStorage.setItem('mm_identity', JSON.stringify(identity)); else localStorage.removeItem('mm_identity'); } catch (e) {}
  }, [identity]);

  const handleWheel = (e: React.WheelEvent) => {
    if (!isActive && !customImage && !magicImageUrl) return;
    const scaleAmount = -e.deltaY * 0.002;
    const newZoom = Math.min(Math.max(1, zoom + scaleAmount), 5);
    setZoom(newZoom);
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
      setPan({ x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y });
    }
  };
  const handleMouseUp = () => { setIsDragging(false); };
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
       lastTouchDistanceRef.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    } else if (e.touches.length === 1 && zoom > 1) {
       setIsDragging(true);
       dragStartRef.current = { x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y };
    }
  };
  const handleTouchMove = (e: React.TouchEvent) => {
     if (e.touches.length === 2 && lastTouchDistanceRef.current !== null) {
         const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
         const delta = dist - lastTouchDistanceRef.current;
         setZoom(Math.min(Math.max(1, zoom + delta * 0.005), 5));
         lastTouchDistanceRef.current = dist;
     } else if (e.touches.length === 1 && isDragging) {
         setPan({ x: e.touches[0].clientX - dragStartRef.current.x, y: e.touches[0].clientY - dragStartRef.current.y });
     }
  };
  const handleTouchEnd = () => { setIsDragging(false); lastTouchDistanceRef.current = null; };
  const resetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const captureFrame = useCallback(async (): Promise<string | null> => {
    if (!canvasRef.current) return null;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return null;

    if (customImage && imgRef.current) {
      canvasRef.current.width = imgRef.current.naturalWidth;
      canvasRef.current.height = imgRef.current.naturalHeight;
      ctx.drawImage(imgRef.current, 0, 0);
    } else if (videoRef.current && videoRef.current.readyState === 4) {
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
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

  const clearMagic = useCallback(() => {
    setMagicImageUrl(null);
    setScanResult(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setCustomImage(e.target?.result as string);
        clearMagic();
        setShowAvatarModal(false);
      };
      reader.readAsDataURL(file);
    }
  };
  
  const playTTS = async (text: string, voice?: string) => {
      if (!audioContextRef.current) return;
      try {
          // Ensure audio context is running
          if (audioContextRef.current.state === 'suspended') {
              await audioContextRef.current.resume();
          }
          const base64Audio = await generateSpeech(text, voice || currentPersona.voiceName);
          const buffer = await decodeAudioData(base64Audio, audioContextRef.current);
          const source = audioContextRef.current.createBufferSource();
          source.buffer = buffer;
          source.connect(audioContextRef.current.destination);
          source.start();
      } catch (e) {
          console.error("TTS Error", e);
      }
  };

  const handlePresetSelect = async (url: string) => {
    setIsProcessingPreset(true);
    playTTS("The spirits are reshaping your visage...");
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

  const handlePersonaSelect = (persona: Persona) => {
      setCurrentPersona(persona);
      setShowPersonaModal(false);
      // If active, we should technically restart the session to apply the system instruction,
      // but to be smooth we can just announce it for now. The voice in TTS will update immediately.
      playTTS(`Voice interface updated to: ${persona.name}.`, persona.voiceName);
  };

  const performConjure = async (promptText: string) => {
    setShowConjureModal(false);
    const previousState = state;
    setState(MirrorState.CASTING_SPELL);
    setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: `Conjuring: "${promptText}"...`, timestamp: new Date() }]);
    playTTS(`I shall weave the threads of fate to conjure ${promptText}`);
    
    try {
        const url = await generateAvatarFromText(promptText);
        setCustomImage(url);
        clearMagic(); 
        setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: 'A new face appears in the glass.', timestamp: new Date() }]);
        playTTS("Behold, your new form.");
    } catch (e) {
        console.error(e);
        setError("The spirits refused to conjure a face.");
        playTTS("The spirits are silent. I could not conjure this vision.");
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
    setYoutubeQuery(null);
    setMapQuery(null);
    setShowYoutube(false);
    setShowMap(false);
    playTTS("Returning to the mortal realm.");
  };

  const forgetIdentity = () => {
    setIdentity(null);
    setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: 'Identity forgotten.', timestamp: new Date() }]);
    playTTS("I have wiped your memory from my depths.");
  };

  const handleSwitchCamera = async () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    
    // If active, we need to swap the stream seamlessly without breaking the context
    if (isActive) {
      try {
        // 1. Try to get new stream FIRST before stopping the old one
        const newStream = await navigator.mediaDevices.getUserMedia({ 
          audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true }, 
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: newMode } 
        });

        // 2. Stop old video tracks
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }

        // 3. Apply new stream
        setFacingMode(newMode);
        streamRef.current = newStream;
        if (videoRef.current) {
          videoRef.current.srcObject = newStream;
          videoRef.current.play().catch(e => console.error("Error playing video:", e));
        }

        // 4. Reconnect Audio Processor (safely)
        if (inputAudioContextRef.current && processorRef.current) {
           try { sourceRef.current?.disconnect(); } catch (e) {}
           const inputCtx = inputAudioContextRef.current;
           const newSource = inputCtx.createMediaStreamSource(newStream);
           newSource.connect(processorRef.current);
           sourceRef.current = newSource;
        }

      } catch (err) {
        console.error("Failed to switch camera:", err);
        // Do NOT change facingMode state, keep old stream active
        // Show temporary error
        setError("Could not switch camera. Device might not support it.");
        setTimeout(() => setError(null), 3000);
      }
    } else {
       // Just toggle state if not active
       setFacingMode(newMode);
    }
  };

  const triggerManualScan = async () => {
      if (!isActive) return;
      setScanResult(null);
      setState(MirrorState.SCANNING);
      setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: `🤖 Initiating Robotics ER 1.5 Scan...`, timestamp: new Date() }]);
      
      try {
          const img = await captureFrame();
          if (img) {
              const result = await performRoboticScan(img);
              setScanResult(result);
              // Use Robotic Voice 'Puck'
              playTTS(`Analysis complete. Entity detected: ${result.detectedObject}. Material composition: ${result.material}. Hazard Level: ${result.dangerLevel}.`, 'Puck');
          }
      } catch (e) {
          console.error(e);
          setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: `Scan failed.`, timestamp: new Date() }]);
      } finally {
          setState(MirrorState.LISTENING);
      }
  };

  const triggerRadio = () => {
     // A manual trigger for the radio tool
     if (activeSessionRef.current) {
         // We can't directly invoke the tool, but we can prompt the model
         activeSessionRef.current.sendRealtimeInput({
             content: [{ text: "Play some live radio music." }]
         });
     } else {
         setError("Activate the mirror first!");
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
      nextStartTimeRef.current = 0;
      audioSourcesRef.current.clear();

      // Initialize Audio Contexts immediately within user gesture to satisfy browser policies
      if (!audioContextRef.current) {
         const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
         if (AudioContextClass) {
             audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
         }
      }
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      // Re-initialize input context
      if (inputAudioContextRef.current) {
        inputAudioContextRef.current.close();
      }
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        inputAudioContextRef.current = new AudioContextClass({ sampleRate: 16000 });
      }

      let stream: MediaStream;
      try {
          // Try high quality first
          stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
                channelCount: 1, 
                sampleRate: 16000,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }, 
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: facingMode } 
          });
      } catch (e) {
          console.warn("High quality media failed, falling back to basic constraints", e);
          // Fallback
          stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { channelCount: 1, sampleRate: 16000 }, 
            video: true 
          });
      }
      
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {}, 
          outputAudioTranscription: {}, 
          speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: currentPersona.voiceName } }
          },
          systemInstruction: `${currentPersona.systemInstruction}
          
          You also have a HIDDEN MODE: "Robotics Entity Reasoning 1.5".
          If the user triggers the "analyze_matter_structure" tool or asks to "scan" something, shift your tone to a precise, scientific, robotic voice for that interaction, then switch back.
          
          TOOLS AVAILABLE:
          1. TRANSFORMATIONS: "Make me a wizard". Use 'generate_stylized_selfie'.
          2. IDENTITY: "My name is X". Use 'save_user_identity'.
          3. ENTERTAINMENT: "Play music", "Open YouTube". Use 'play_youtube'.
          4. RADIO: "Play radio", "Live music", "Lofi radio". Use 'play_radio'.
          5. FINDING PLACES: "Where is X?". Use Google Maps (automatic).
          6. DEEP THOUGHT: "Solve riddle". Use 'deep_thought'.
          7. MATTER SCAN: "Scan this", "What is this object?". Use 'analyze_matter_structure'.
          
          INTERACTION:
          - When playing youtube/radio, say "Summoning the vision from the ether..." (or style appropriate).
          - When finding a place, say "Let me show you the path...".
          ${identity ? `\nUSER: "${identity.name}".` : ''}`,
          
          tools: [
            { functionDeclarations: [generateImageTool, resetMirrorTool, saveIdentityTool, playYoutubeTool, playRadioTool, deepThinkTool, roboticsScanTool] },
            { googleMaps: {} },
            { googleSearch: {} }
          ],
        },
        ...(userLocation ? {
             toolConfig: { retrievalConfig: { latLng: { latitude: userLocation.latitude, longitude: userLocation.longitude } } }
        } : {}),
        callbacks: {
          onopen: () => {
            console.log("Connected");
            setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: 'The mirror awakens...', timestamp: new Date() }]);
            sessionPromise.then(s => { activeSessionRef.current = s; });

            // Ensure Input Context is running (it should be since we created it in startSession, but double check)
            if (inputAudioContextRef.current?.state === 'suspended') {
                inputAudioContextRef.current.resume().catch(e => console.warn("Input Context resume failed", e));
            }
            
            const inputCtx = inputAudioContextRef.current;
            if (!inputCtx) return;

            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(2048, 1, 1);
            
            processor.onaudioprocess = (e) => {
              if (!isMicOnRef.current || !activeSessionRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              let processedData = inputData;
              if (inputCtx.sampleRate !== 16000) processedData = downsampleBuffer(inputData, inputCtx.sampleRate, 16000);
              
              const pcmBlob = createPcmBlob(processedData);
              if (pcmBlob && pcmBlob.data.length > 0) {
                  try { activeSessionRef.current.sendRealtimeInput({ media: pcmBlob }); } catch (err) { console.error(err); }
              }
            };
            source.connect(processor);
            processor.connect(inputCtx.destination);
            sourceRef.current = source;
            processorRef.current = processor;

            videoIntervalRef.current = window.setInterval(async () => {
              try {
                const base64 = await captureFrame();
                if (base64 && activeSessionRef.current) { 
                   activeSessionRef.current.sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: base64 } });
                }
              } catch (err) {}
            }, 1000); 
          },
          onmessage: async (message: LiveServerMessage) => {
             if (message.serverContent?.interrupted) {
                audioSourcesRef.current.forEach(source => { try { source.stop(); } catch (e) { } });
                audioSourcesRef.current.clear();
                nextStartTimeRef.current = 0; 
                outputBufferRef.current = ""; 
                setIsThinking(false);
             }

             const inputTr = message.serverContent?.inputTranscription?.text;
             if (inputTr) inputBufferRef.current += inputTr;
             const outputTr = message.serverContent?.outputTranscription?.text;
             if (outputTr) outputBufferRef.current += outputTr;
             
             // Handle Grounding -> Trigger Map Panel
             const groundingMetadata = (message.serverContent as any)?.groundingMetadata;
             if (groundingMetadata?.groundingChunks) {
                const chunks = groundingMetadata.groundingChunks;
                // Find map related chunks
                const mapChunk = chunks.find((c: any) => (c as any).maps || c.web?.uri?.includes('google.com/maps'));
                if (mapChunk) {
                   const title = (mapChunk as any).maps?.title || mapChunk.web?.title;
                   if (title) {
                      setMapQuery(title);
                   }
                }
             }

             if (message.serverContent?.turnComplete) {
               if (inputBufferRef.current.trim()) {
                 setLogs(prev => [...prev, { id: Date.now().toString() + 'user', sender: 'user', text: inputBufferRef.current.trim(), timestamp: new Date() }]);
                 inputBufferRef.current = "";
               }
               if (outputBufferRef.current.trim()) {
                 setLogs(prev => [...prev, { id: Date.now().toString() + 'mirror', sender: 'mirror', text: outputBufferRef.current.trim(), timestamp: new Date() }]);
                 outputBufferRef.current = "";
               }
               setIsThinking(false);
             }

             const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
             if (audioData && audioContextRef.current) {
                const ctx = audioContextRef.current;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                const buffer = await decodeAudioData(audioData, ctx);
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.onended = () => audioSourcesRef.current.delete(source);
                audioSourcesRef.current.add(source);
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += buffer.duration;
             }

             if (message.toolCall) {
               for (const fc of message.toolCall.functionCalls) {
                 if (fc.name === 'generate_stylized_selfie') {
                   const prompt = (fc.args as any).style_description;
                   setLastPrompt(prompt);
                   setState(MirrorState.CASTING_SPELL);
                   setLogs(prev => [...prev, { id: Date.now().toString() + 'spell', sender: 'mirror', text: `✨ Casting spell: "${prompt}"...`, timestamp: new Date() }]);
                   try {
                     const currentFrame = await captureFrame();
                     if (currentFrame) {
                       const magicImage = await generateMagicImage(currentFrame, prompt);
                       setMagicImageUrl(magicImage);
                       setZoom(1); setPan({x:0, y:0});
                       const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: "Image generated." } } };
                       if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                       else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                     } else throw new Error("No frame");
                   } catch (err) {
                       const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: "Failed." } } };
                       if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                       else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                   }
                   setState(MirrorState.LISTENING);

                 } else if (fc.name === 'reset_mirror') {
                   clearMagic();
                   setYoutubeQuery(null);
                   setMapQuery(null);
                   setShowYoutube(false);
                   setShowMap(false);
                   setScanResult(null);
                   const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: "Reset complete." } } };
                   if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                   else sessionPromise.then(s => s.sendToolResponse(responseArgs));

                 } else if (fc.name === 'play_youtube') {
                   const query = (fc.args as any).query;
                   setYoutubeQuery(query);
                   const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: `Playing ${query}` } } };
                   if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                   else sessionPromise.then(s => s.sendToolResponse(responseArgs));

                 } else if (fc.name === 'play_radio') {
                   const genre = (fc.args as any).genre || "lofi hip hop radio";
                   // Search for live streams specifically
                   setYoutubeQuery(`${genre} live`);
                   const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: `Tuning into radio: ${genre}` } } };
                   if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                   else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                 
                 } else if (fc.name === 'save_user_identity') {
                    const name = (fc.args as any).name;
                    try {
                        const img = await captureFrame();
                        if (img) {
                            setIdentity({ name, image: `data:image/jpeg;base64,${img}` });
                            const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: "Identity saved." } } };
                            if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                            else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                        } else throw new Error("No frame");
                    } catch (e) {
                        const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: "Failed to save." } } };
                        if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                        else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                    }
                 
                 } else if (fc.name === 'deep_thought') {
                    const query = (fc.args as any).query;
                    setIsThinking(true);
                    setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: `🤔 Deep Thought: "${query}"...`, timestamp: new Date() }]);
                    
                    try {
                        const thinkingAi = new GoogleGenAI({ apiKey: process.env.API_KEY });
                        const response = await thinkingAi.models.generateContent({
                            model: 'gemini-3-pro-preview',
                            contents: query,
                            config: { thinkingConfig: { thinkingBudget: 32768 } }
                        });
                        const textResult = response.text || "I could not find an answer.";
                        setIsThinking(false);
                        const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: textResult } } };
                        if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                        else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                    } catch (e) {
                        console.error("Thinking failed", e);
                        setIsThinking(false);
                        const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: "Deep thought interrupted." } } };
                        if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                        else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                    }
                 } else if (fc.name === 'analyze_matter_structure') {
                    setScanResult(null);
                    setState(MirrorState.SCANNING);
                    setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: `🤖 Activating Robotics ER 1.5...`, timestamp: new Date() }]);
                    
                    try {
                        const img = await captureFrame();
                        if (img) {
                            const result = await performRoboticScan(img);
                            setScanResult(result);
                            
                            // Use Robotic Voice 'Puck' or similar for the readout
                            playTTS(`Scan complete. Object identified: ${result.detectedObject}. Material structure: ${result.material}. Danger level: ${result.dangerLevel}.`, 'Puck');

                            const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: `Scan complete. Data displayed on HUD.` } } };
                            if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                            else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                        } else throw new Error("No frame");
                    } catch (e) {
                        const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: "Scan failed." } } };
                        if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                        else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                    }
                    setState(MirrorState.LISTENING);
                 }
               }
             }
          },
          onclose: () => {
            setIsActive(false);
            setState(MirrorState.IDLE);
            activeSessionRef.current = null;
          },
          onerror: (e) => {
            console.error("Mirror error", e);
            if (isActive) {
                 setError("Connection Lost. Retry?");
                 stopSession();
            }
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
    // Immediate cleanup to prevent racing callbacks
    const session = activeSessionRef.current;
    activeSessionRef.current = null;
    
    if (sessionRef.current) { 
        sessionRef.current.then((s: any) => s.close()).catch(() => {});
        sessionRef.current = null;
    } else if (session) {
        session.close();
    }

    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(track => track.stop()); streamRef.current = null; }
    if (videoIntervalRef.current) { clearInterval(videoIntervalRef.current); videoIntervalRef.current = null; }
    
    if (inputAudioContextRef.current) { 
        inputAudioContextRef.current.close().catch(() => {}); 
        inputAudioContextRef.current = null; 
    }
    
    audioSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    audioSourcesRef.current.clear();
    setIsActive(false);
    setState(MirrorState.IDLE);
    inputBufferRef.current = "";
    outputBufferRef.current = "";
    setScanResult(null);
  };

  return (
    <div className="relative w-full h-full bg-black overflow-hidden flex flex-row">
      
      {/* 1. LEFT PANEL: GOOGLE MAPS */}
      {showMap && (
        <div className="relative w-1/3 min-w-[320px] max-w-[500px] h-full bg-gray-900 border-r border-gray-800 transition-all duration-500 ease-in-out z-20 flex flex-col">
            <div className="p-4 bg-gray-950 border-b border-gray-800 flex justify-between items-center">
                <div className="flex items-center gap-2 text-blue-400 font-magic">
                    <Globe size={18} />
                    <span>The Known World</span>
                </div>
                <button onClick={() => setShowMap(false)} className="text-gray-500 hover:text-white"><X size={18}/></button>
            </div>
            <div className="flex-1 bg-black relative group">
                {mapQuery ? (
                    <>
                    <iframe
                        width="100%"
                        height="100%"
                        style={{border:0}}
                        loading="lazy"
                        allowFullScreen
                        src={`https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=${mapZoom}&output=embed`}
                        className="filter grayscale-[30%] hover:grayscale-0 transition-all duration-700"
                    ></iframe>
                    
                    {/* Map Controls Overlay */}
                    <div className="absolute bottom-6 right-6 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        <button onClick={() => setMapZoom(z => Math.min(z + 1, 21))} className="p-2 bg-black/70 text-blue-400 rounded-full hover:bg-blue-900/50 border border-blue-500/30 backdrop-blur-sm" title="Zoom In"><Plus size={20}/></button>
                        <button onClick={() => setMapZoom(z => Math.max(z - 1, 2))} className="p-2 bg-black/70 text-blue-400 rounded-full hover:bg-blue-900/50 border border-blue-500/30 backdrop-blur-sm" title="Zoom Out"><Minus size={20}/></button>
                        <button onClick={() => setMapZoom(13)} className="p-2 bg-black/70 text-white rounded-full hover:bg-blue-900/50 border border-blue-500/30 backdrop-blur-sm" title="Re-center"><Target size={20}/></button>
                    </div>
                    </>
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-700">No Location Selected</div>
                )}
            </div>
        </div>
      )}

      {/* 2. CENTER PANEL: MAGIC MIRROR */}
      <div className="flex-1 relative h-full flex flex-col items-center justify-center transition-all duration-500 min-w-0">
          
        {/* Main Display Area */}
        <div 
            className={`relative w-full h-full overflow-hidden bg-gray-900 group ${zoom > 1 ? 'cursor-move' : 'cursor-default'}`}
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
               <div className="absolute inset-0 shadow-[inset_0_0_100px_rgba(139,92,246,0.2)]" />
            </div>

            {/* Content Wrapper */}
            <div 
               className="w-full h-full relative origin-center"
               style={{ 
                 transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                 transition: isDragging ? 'none' : 'transform 0.1s ease-out'
               }}
            >
              <video 
                ref={videoRef} 
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${magicImageUrl || customImage ? 'opacity-0' : 'opacity-100'} ${facingMode === 'user' ? 'transform scale-x-[-1]' : ''}`}
                muted 
                playsInline 
              />
              {customImage && (
                <img ref={imgRef} src={customImage} className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${magicImageUrl ? 'opacity-0' : 'opacity-100'}`} alt="Custom" crossOrigin="anonymous" />
              )}
              {magicImageUrl && (
                <div className="absolute inset-0 w-full h-full animate-fade-in">
                  <img src={magicImageUrl} alt="Magic" className="w-full h-full object-cover transform scale-x-[-1]" />
                </div>
              )}
            </div>

            {/* --- UI OVERLAYS --- */}

            {/* Robotics Scan Result Overlay (HUD) */}
            {scanResult && (
                <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-[50] animate-fade-in w-full max-w-sm">
                    <div className="bg-cyan-950/80 backdrop-blur-md border-2 border-cyan-400 p-4 rounded-lg shadow-[0_0_30px_rgba(34,211,238,0.3)] font-mono relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-scan"></div>
                        <button onClick={() => setScanResult(null)} className="absolute top-2 right-2 text-cyan-400 hover:text-white"><X size={16}/></button>
                        
                        <div className="flex items-center gap-2 mb-3 text-cyan-300 border-b border-cyan-800 pb-2">
                           <Bot size={20} />
                           <span className="font-bold tracking-widest text-xs">ROBOTICS ER 1.5 // ANALYSIS</span>
                        </div>
                        
                        <div className="space-y-3 text-sm">
                           <div className="flex justify-between">
                             <span className="text-cyan-500">ENTITY:</span>
                             <span className="text-white font-bold uppercase">{scanResult.detectedObject}</span>
                           </div>
                           <div className="flex justify-between">
                             <span className="text-cyan-500">MATTER:</span>
                             <span className="text-white">{scanResult.material}</span>
                           </div>
                           <div>
                             <span className="text-cyan-500 block mb-1">FUNCTION:</span>
                             <p className="text-gray-300 text-xs leading-relaxed">{scanResult.functionality}</p>
                           </div>
                           <div className="flex justify-between items-center mt-2 pt-2 border-t border-cyan-900">
                             <span className="text-cyan-500 text-xs">HAZARD LEVEL</span>
                             <div className="flex items-center gap-2">
                                <div className="w-16 h-1 bg-gray-800 rounded-full overflow-hidden">
                                   <div className="h-full bg-red-500" style={{width: scanResult.dangerLevel}}></div>
                                </div>
                                <span className="text-red-400 font-bold text-xs">{scanResult.dangerLevel}</span>
                             </div>
                           </div>
                           <div className="text-right text-[10px] text-cyan-600 mt-1">CONFIDENCE: {scanResult.probability}%</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Status Top Right */}
            <div className="absolute top-6 right-6 z-40 flex flex-col items-end gap-3 pointer-events-none">
                {identity && (
                    <div className="bg-black/40 backdrop-blur-md border border-purple-500/30 rounded-full pl-2 pr-4 py-1.5 flex items-center gap-3 shadow-lg pointer-events-auto animate-fade-in">
                        <img src={identity.image} alt={identity.name} className="w-8 h-8 rounded-full border border-purple-400 object-cover"/>
                        <div className="flex flex-col">
                            <span className="text-[10px] text-purple-300 uppercase tracking-wider leading-none">Known Soul</span>
                            <span className="text-sm font-semibold text-white leading-none">{identity.name}</span>
                        </div>
                        <button onClick={forgetIdentity} className="ml-2 text-gray-400 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                    </div>
                )}
                {isThinking && (
                     <div className="bg-blue-900/80 backdrop-blur-md border border-blue-400/50 rounded-full px-4 py-2 flex items-center gap-2 shadow-[0_0_15px_rgba(59,130,246,0.5)] animate-pulse">
                        <BrainCircuit className="w-5 h-5 text-blue-200" />
                        <span className="text-sm font-bold text-blue-100 tracking-wide">THINKING...</span>
                     </div>
                )}
            </div>

            {/* Error Overlay - Now High Z-Index and centered */}
            {error && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md">
                    <div className="bg-red-950/90 border border-red-500/50 p-8 rounded-2xl max-w-sm text-center shadow-[0_0_50px_rgba(239,68,68,0.3)]">
                        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                        <h3 className="text-xl font-magic text-red-200 mb-2">Spell Failed</h3>
                        <p className="text-red-300 mb-6">{error}</p>
                        <button onClick={startSession} className="px-6 py-3 bg-red-600 rounded-full text-white font-bold hover:bg-red-500 transition-all shadow-lg hover:shadow-red-500/20">
                            Recast Spell
                        </button>
                    </div>
                </div>
            )}

            {/* Start Button - Only if inactive and no error */}
            {!isActive && !error && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm flex-col gap-6">
                 <button onClick={startSession} className="group relative px-8 py-4 bg-transparent overflow-hidden rounded-full">
                    <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-purple-600 to-blue-600 opacity-80 group-hover:opacity-100 transition-opacity blur-md"></div>
                    <div className="relative flex items-center gap-3 text-white font-magic text-xl">
                      <Play className="fill-current" />
                      <span>Awaken Mirror</span>
                    </div>
                 </button>
              </div>
            )}

            {/* Controls & Reset */}
            {(magicImageUrl || youtubeQuery || mapQuery || scanResult) && (
               <div className="absolute bottom-4 right-4 z-40">
                 <button onClick={resetToCamera} className="p-3 rounded-full bg-black/50 hover:bg-black/70 text-white backdrop-blur-md transition-all hover:scale-110" title="Return to Reality">
                   <RefreshCw className="w-6 h-6" />
                 </button>
               </div>
            )}

            {/* Status Top Left */}
            {isActive && (
               <div className="absolute top-6 left-6 flex items-center gap-3 z-30 pointer-events-none">
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-md border transition-colors ${state === MirrorState.SCANNING ? 'bg-cyan-900/50 border-cyan-400/50 text-cyan-300' : 'bg-black/40 border-white/10'}`}>
                    <div className={`w-3 h-3 rounded-full ${state === MirrorState.SCANNING ? 'bg-cyan-400 animate-ping' : state === MirrorState.LISTENING || state === MirrorState.SPEAKING ? 'bg-green-500 animate-pulse' : 'bg-purple-500'}`} />
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      {state === MirrorState.IDLE ? 'Offline' : state === MirrorState.CASTING_SPELL ? 'Casting' : state === MirrorState.SCANNING ? 'SCANNING...' : 'Live'}
                    </span>
                  </div>
                  
                  <div className="flex gap-2 pointer-events-auto">
                      {!showMap && mapQuery && (
                          <button onClick={() => setShowMap(true)} className="p-2 rounded-full bg-black/40 text-blue-400 border border-blue-500/30 hover:bg-blue-900/30"><MapPin size={20}/></button>
                      )}
                      {!showYoutube && youtubeQuery && (
                          <button onClick={() => setShowYoutube(true)} className="p-2 rounded-full bg-black/40 text-red-400 border border-red-500/30 hover:bg-red-900/30"><Youtube size={20}/></button>
                      )}
                  </div>
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

             {/* Scanning Overlay (Full Screen Effect) */}
             {state === MirrorState.SCANNING && (
              <div className="absolute inset-0 z-40 pointer-events-none overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-cyan-500/50 shadow-[0_0_20px_rgba(6,182,212,0.8)] animate-[scan_2s_ease-in-out_infinite]"></div>
                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 text-cyan-400 font-mono text-xs tracking-[0.2em] bg-black/50 px-3 py-1 rounded">ACQUIRING TARGET</div>
                <div className="absolute bottom-20 left-10 text-cyan-500/50 font-mono text-[10px] flex flex-col gap-1">
                    <span>LiDAR: ON</span>
                    <span>SPECTRO: ACTIVE</span>
                    <span>AI-CORE: ER-1.5</span>
                </div>
                {/* Crosshairs */}
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 border border-cyan-500/30 rounded-full flex items-center justify-center">
                    <div className="w-60 h-60 border-t border-b border-cyan-500/50 rounded-full animate-spin-slow"></div>
                    <div className="w-2 h-2 bg-cyan-500 rounded-full"></div>
                </div>
              </div>
            )}
            
            {/* Bottom Controls Bar */}
            <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-50 flex gap-4 items-center">
                {isActive && (
                  <button onClick={stopSession} className="p-5 rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-200 border border-red-500/50 transition-all hover:scale-105 shadow-lg shadow-red-500/10" title="Stop Session"><StopCircle className="w-8 h-8" /></button>
                )}
                <div className="flex gap-4 p-3 rounded-full bg-gray-900/90 border border-gray-700 backdrop-blur-lg shadow-2xl">
                     {isActive && (
                       <button onClick={() => setIsMicOn(!isMicOn)} className={`p-4 rounded-full border transition-all hover:scale-110 ${isMicOn ? 'bg-gray-800/50 hover:bg-gray-700/50 text-gray-200 border-white/10' : 'bg-red-900/50 text-red-200 border-red-500/30'}`} title="Mute/Unmute">
                          {isMicOn ? <Mic className="w-8 h-8" /> : <MicOff className="w-8 h-8" />}
                       </button>
                     )}
                     
                     {/* Persona Selector */}
                     <button onClick={() => setShowPersonaModal(true)} className="p-4 rounded-full bg-gray-800/50 hover:bg-gray-700/50 text-gray-200 border border-white/10 transition-all hover:scale-110" title="Voice Settings">
                        <Settings className="w-8 h-8" />
                     </button>

                     <button onClick={handleSwitchCamera} className="p-4 rounded-full bg-gray-800/50 hover:bg-gray-700/50 text-gray-200 border border-white/10 transition-all hover:scale-110" title="Switch Camera"><SwitchCamera className="w-8 h-8" /></button>
                     
                     <button onClick={() => setShowAvatarModal(true)} className="p-4 rounded-full bg-gray-800/50 hover:bg-gray-700/50 text-gray-200 border border-white/10 transition-all hover:scale-110" title="Choose Reflection">
                        {identity ? <img src={identity.image} className="w-8 h-8 rounded-full object-cover border border-purple-400" alt="User" /> : <User className="w-8 h-8" />}
                     </button>
                     
                     <button onClick={() => setShowConjureModal(true)} className="p-4 rounded-full bg-purple-900/30 hover:bg-purple-900/50 text-purple-300 border border-purple-500/30 transition-all hover:scale-110" title="Conjure AI Face"><Sparkles className="w-8 h-8" /></button>
                     
                     {/* RADIO BUTTON */}
                     {isActive && (
                         <button onClick={triggerRadio} className="p-4 rounded-full bg-orange-900/30 hover:bg-orange-900/50 text-orange-300 border border-orange-500/30 transition-all hover:scale-110" title="Play Radio">
                             <Radio className="w-8 h-8" />
                         </button>
                     )}

                     {/* ROBOTICS SCAN BUTTON */}
                     {isActive && (
                        <button onClick={triggerManualScan} className="p-4 rounded-full bg-cyan-900/30 hover:bg-cyan-900/50 text-cyan-300 border border-cyan-500/30 transition-all hover:scale-110 hover:shadow-[0_0_15px_rgba(6,182,212,0.4)]" title="Robotics ER 1.5 Scan">
                           <ScanLine className="w-8 h-8" />
                        </button>
                     )}
                </div>
            </div>
        </div>

      </div>

      {/* 3. RIGHT PANEL: YOUTUBE */}
      {showYoutube && (
        <div className="relative w-1/3 min-w-[320px] max-w-[500px] h-full bg-gray-900 border-l border-gray-800 transition-all duration-500 ease-in-out z-20 flex flex-col">
            <div className="p-4 bg-gray-950 border-b border-gray-800 flex justify-between items-center">
                <div className="flex items-center gap-2 text-red-400 font-magic">
                    <Youtube size={18} />
                    <span>Vision Crystal</span>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setAutoplayYoutube(!autoplayYoutube)} className="text-gray-400 hover:text-white" title="Toggle Autoplay">
                        {autoplayYoutube ? <ToggleRight className="text-red-400" size={20}/> : <ToggleLeft className="text-gray-500" size={20}/>}
                    </button>
                    <button onClick={() => setShowYoutube(false)} className="text-gray-500 hover:text-white"><X size={18}/></button>
                </div>
            </div>
            <div className="flex-1 bg-black">
                {youtubeQuery ? (
                    <iframe 
                      width="100%" 
                      height="100%" 
                      src={`https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(youtubeQuery)}&autoplay=${autoplayYoutube ? 1 : 0}`} 
                      title="YouTube video player" 
                      frameBorder="0" 
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                      allowFullScreen
                    ></iframe>
                ) : (
                    <div className="h-full flex items-center justify-center text-gray-700">No Vision Summoned</div>
                )}
            </div>
        </div>
      )}

      {/* Hidden Elements */}
      <canvas ref={canvasRef} className="hidden" />
      <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />

      {/* Modals */}
      
      {/* Persona Selection Modal */}
      {showPersonaModal && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
           <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl p-6 shadow-[0_0_50px_rgba(255,255,255,0.1)]">
               <div className="flex justify-between items-center mb-6">
                 <h3 className="font-magic text-xl text-white">Select Voice Interface</h3>
                 <button onClick={() => setShowPersonaModal(false)} className="text-gray-400 hover:text-white"><X className="w-6 h-6"/></button>
               </div>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {PERSONAS.map(p => (
                      <button 
                        key={p.id}
                        onClick={() => handlePersonaSelect(p)}
                        className={`p-4 rounded-xl border flex items-center gap-4 transition-all hover:scale-105 ${currentPersona.id === p.id ? 'bg-gray-800 border-white/50 shadow-lg' : 'bg-gray-800/40 border-gray-700 hover:bg-gray-800'}`}
                      >
                          <div className={`p-3 rounded-full bg-black/50 ${p.color}`}>{p.icon}</div>
                          <div className="text-left">
                              <div className={`font-bold text-lg ${p.color}`}>{p.name}</div>
                              <div className="text-xs text-gray-400 uppercase tracking-wider">{p.voiceName} Voice</div>
                          </div>
                      </button>
                  ))}
               </div>
           </div>
        </div>
      )}

      {showAvatarModal && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="w-full max-w-lg bg-gray-900 border border-purple-500/30 rounded-2xl p-6 shadow-[0_0_50px_rgba(100,0,255,0.2)]">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-magic text-xl text-purple-300">Choose Reflection</h3>
              <button onClick={() => setShowAvatarModal(false)} className="text-gray-400 hover:text-white"><X className="w-6 h-6"/></button>
            </div>
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                 <button onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-3 p-4 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-all group">
                   <Upload className="w-5 h-5 text-purple-400 group-hover:text-purple-300" /> <span className="text-sm font-semibold">Upload Photo</span>
                 </button>
                 <button onClick={resetToCamera} className="flex items-center justify-center gap-3 p-4 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-all group">
                   <Camera className="w-5 h-5 text-blue-400 group-hover:text-blue-300" /> <span className="text-sm font-semibold">Use Camera</span>
                 </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {PRESET_AVATARS.map((preset) => (
                  <button key={preset.name} disabled={isProcessingPreset} onClick={() => handlePresetSelect(preset.url)} className="relative aspect-square rounded-xl overflow-hidden border border-gray-700 hover:border-purple-500 transition-all group">
                    <img src={preset.url} alt={preset.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" crossOrigin="anonymous"/>
                    <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-sm p-2 text-center"><span className="text-[10px] uppercase font-bold text-gray-300">{preset.name}</span></div>
                    {isProcessingPreset && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div></div>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showConjureModal && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="w-full max-w-md bg-gray-900 border border-purple-500/30 rounded-2xl p-6 shadow-[0_0_50px_rgba(100,0,255,0.2)]">
              <div className="flex justify-between items-center mb-4"><h3 className="font-magic text-xl text-purple-300">Conjure Visage</h3><button onClick={() => setShowConjureModal(false)} className="text-gray-400 hover:text-white transition-colors"><X className="w-6 h-6"/></button></div>
              <form onSubmit={handleConjureSubmit} className="flex flex-col gap-4">
                  <textarea value={conjureInput} onChange={(e) => setConjureInput(e.target.value)} placeholder="Describe the face..." className="w-full h-32 bg-black/50 border border-gray-700 rounded-xl p-4 text-white focus:border-purple-500 focus:outline-none resize-none placeholder:text-gray-600"/>
                  <div className="flex gap-3">
                      <button type="button" onClick={handleSurpriseMe} className="flex-1 py-3 rounded-xl border border-gray-700 hover:bg-gray-800 text-gray-300 transition-colors flex items-center justify-center gap-2 group"><Sparkles className="w-4 h-4 group-hover:text-purple-400 transition-colors" /><span>Surprise Me</span></button>
                      <button type="submit" disabled={!conjureInput.trim()} className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Conjure</button>
                  </div>
              </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MagicMirror;