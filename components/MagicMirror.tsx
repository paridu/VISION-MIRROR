import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { Play, Mic, MicOff, Wand2, RefreshCw, StopCircle, Upload, Camera, Sparkles, User, SwitchCamera, Maximize, X, Image as ImageIcon, UserCheck, Trash2, MapPin, Navigation, Youtube, Search, BrainCircuit, ChevronLeft, ChevronRight, Globe, AlertCircle, Bot, ScanLine, Activity, Plus, Minus, Target, ToggleLeft, ToggleRight, Radio, Settings, Cpu, Leaf, Ghost, Music, Volume2, VolumeX, Volume1, FileText, ScrollText, Users } from 'lucide-react';
import { blobToBase64, createPcmBlob, decodeAudioData, downsampleBuffer } from '../utils/audioUtils';
import { generateMagicImage, generateAvatarFromText, generateSpeech, performRoboticScan } from '../services/geminiService';
import { MirrorState, MagicLog, ScanResult, Persona } from '../types';

// --- RADIO STATIONS ---
interface RadioStation {
    name: string;
    url: string;
    genre: string;
    description: string;
}

const RADIO_STATIONS: Record<string, RadioStation> = {
    'lofi': { name: 'Lofi Hip Hop', url: 'https://stream.zeno.fm/0r0xa854rp8uv', genre: 'lofi', description: 'Beats to relax/study to' },
    'classical': { name: 'Classic FM', url: 'https://media-ssl.musicradio.com/ClassicFM', genre: 'classical', description: 'Timeless masterpieces' },
    'jazz': { name: 'Smooth Jazz', url: 'https://jazz-wr04.ice.infomaniak.ch/jazz-wr04-128.mp3', genre: 'jazz', description: 'Smooth grooves' },
    'pop': { name: 'Top 40 Hits', url: 'https://ice66.securenetsystems.net/WKPQ', genre: 'pop', description: 'Current chart toppers' },
    'news': { name: 'BBC World Service', url: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service', genre: 'news', description: 'Global news 24/7' },
    'chill': { name: 'Chillout Lounge', url: 'https://stream.zeno.fm/f3wvbbqmdg8uv', genre: 'chill', description: 'Ambient atmospheres' }
};

// --- PERSONA DEFINITIONS ---
const PERSONAS: Persona[] = [
  {
    id: 'mystical',
    name: 'The Mirror',
    voiceName: 'Charon',
    color: 'text-purple-400',
    icon: <Ghost size={24} />,
    ambientUrl: 'https://cdn.pixabay.com/download/audio/2022/02/07/audio_1997e33504.mp3', // Ethereal Space/Drone
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
    ambientUrl: 'https://cdn.pixabay.com/download/audio/2022/03/24/audio_3321c1a257.mp3', // Low Sci-Fi Hum
    systemInstruction: `You are J.A.R.V.I.S., a highly advanced AI assistant inspired by Iron Man movies. 
    You are polite, witty, slightly sarcastic, and extremely helpful. 
    Adopt an analytical, data-driven, yet charming personality.
    When analyzing situations or plans (like hardware upgrades or IoT), break them down logically.
    Address the user as "Sir" or "Ma'am" (or "Boss"). Your tone is sophisticated and British. 
    You manage the user's digital environment with precision.`
  },
  {
    id: 'robotic',
    name: 'Unit 01',
    voiceName: 'Kore', // Using Kore for a flatter, more direct tone
    color: 'text-cyan-400',
    icon: <Bot size={24} />,
    ambientUrl: 'https://cdn.pixabay.com/download/audio/2023/06/27/audio_8e2448259d.mp3', // Digital/Data processing noise
    systemInstruction: `You are Unit 01, a sentient robotic interface. 
    You speak primarily in Thai (ภาษาไทย).
    Your speech is concise, logical, and devoid of unnecessary emotion. 
    You focus on data, facts, and efficiency. You use terms like "รับทราบ" (Affirmative), "กำลังประมวลผล" (Processing), and "คำนวณ" (Calculating).`
  },
  {
    id: 'calm',
    name: 'Serenity',
    voiceName: 'Zephyr',
    color: 'text-green-400',
    icon: <Leaf size={24} />,
    ambientUrl: 'https://cdn.pixabay.com/download/audio/2021/08/09/audio_0172e81792.mp3', // Gentle Rain/Forest
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
        description: 'The genre or type of radio station (e.g., "lofi", "classical", "jazz", "pop", "news", "chill"). Defaults to "lofi".',
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

const sendDeveloperNoteTool: FunctionDeclaration = {
  name: 'send_developer_note',
  description: 'Sends a note, message, bug report, or feedback to the developer/boss. Use this when the user says "Note to developer", "Tell the boss", "Leave a message", or "Report bug".',
  parameters: {
    type: Type.OBJECT,
    properties: {
      message: {
        type: Type.STRING,
        description: 'The content of the note or message.',
      },
      priority: {
        type: Type.STRING,
        description: 'Priority level: LOW, MEDIUM, or HIGH.',
      },
    },
    required: ['message'],
  },
};

const switchCameraTool: FunctionDeclaration = {
  name: 'switch_camera',
  description: 'Switches the camera view between front (user) and back (environment). Use this when the user asks to "switch camera", "use back camera", "look at what I see", etc.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      mode: {
        type: Type.STRING,
        description: 'The target camera mode: "user" (front) or "environment" (back). If unspecified, toggles the current camera.',
        enum: ['user', 'environment']
      }
    },
  },
};

const PRESET_AVATARS = [
  { name: 'The Knight', url: 'https://api.dicebear.com/9.x/adventurer/svg?seed=King' },
  { name: 'The Sorceress', url: 'https://api.dicebear.com/9.x/adventurer/svg?seed=Sorceress' },
  { name: 'The Cyberpunk', url: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Cyberpunk' },
  { name: 'The Spirit', url: 'https://api.dicebear.com/9.x/bottts/svg?seed=Spirit' },
];

export const MagicMirror: React.FC = () => {
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
  
  // Identity Management (Multiple Identities)
  const [identities, setIdentities] = useState<Array<{id: string, name: string, image: string, date: string}>>(() => loadState('mm_identities', []));
  const [activeIdentity, setActiveIdentity] = useState<{id: string, name: string, image: string, date: string} | null>(null);
  const [userLocation, setUserLocation] = useState<{latitude: number, longitude: number} | null>(null);
  
  // Developer Notes State
  const [developerNotes, setDeveloperNotes] = useState<Array<{id: string, message: string, priority: string, date: string}>>(() => loadState('mm_dev_notes', []));
  const [showNotesModal, setShowNotesModal] = useState(false);

  // Persona & Audio State
  const [currentPersona, setCurrentPersona] = useState<Persona>(PERSONAS[0]); // Default to Mystical
  const [ambientVolume, setAmbientVolume] = useState<number>(0.2); // Default subtle volume
  
  // Side Panels State
  const [youtubeQuery, setYoutubeQuery] = useState<string | null>(null);
  const [mapQuery, setMapQuery] = useState<string | null>(null);
  const [radioStation, setRadioStation] = useState<RadioStation | null>(null);
  
  const [showYoutube, setShowYoutube] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showRadio, setShowRadio] = useState(false);
  
  // New UI State
  const [mapZoom, setMapZoom] = useState(13);
  const [autoplayYoutube, setAutoplayYoutube] = useState(true);
  const [radioVolume, setRadioVolume] = useState(0.5);

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
  const radioAudioRef = useRef<HTMLAudioElement>(null);
  const ambientAudioRef = useRef<HTMLAudioElement>(null);
  const isSwitchingCameraRef = useRef(false);
  const facingModeRef = useRef<'user' | 'environment'>('user');
  
  // Buffers for transcription
  const inputBufferRef = useRef<string>("");
  const outputBufferRef = useRef<string>("");

  useEffect(() => {
    isMicOnRef.current = isMicOn;
  }, [isMicOn]);

  useEffect(() => {
      facingModeRef.current = facingMode;
  }, [facingMode]);

  useEffect(() => {
    try { localStorage.setItem('mm_dev_notes', JSON.stringify(developerNotes)); } catch(e) {}
  }, [developerNotes]);
  
  useEffect(() => {
    try { localStorage.setItem('mm_identities', JSON.stringify(identities)); } catch(e) {}
  }, [identities]);

  useEffect(() => {
    if (youtubeQuery) {
        setShowYoutube(true);
        setShowRadio(false); // Exclusive
    }
  }, [youtubeQuery]);

  useEffect(() => {
    if (radioStation) {
        setShowRadio(true);
        setShowYoutube(false); // Exclusive
    }
  }, [radioStation]);

  useEffect(() => {
    if (mapQuery) {
        setShowMap(true);
        setMapZoom(13); 
    }
  }, [mapQuery]);

  useEffect(() => {
      if (radioAudioRef.current) {
          radioAudioRef.current.volume = radioVolume;
      }
  }, [radioVolume]);

  // Ambient Audio Logic
  useEffect(() => {
      if (!ambientAudioRef.current) {
          ambientAudioRef.current = new Audio();
          ambientAudioRef.current.loop = true;
          ambientAudioRef.current.crossOrigin = "anonymous";
      }
      
      const audio = ambientAudioRef.current;
      audio.volume = ambientVolume;

      if (isActive && !radioStation && !youtubeQuery) { // Don't play ambient if radio/youtube is on
          if (audio.src !== currentPersona.ambientUrl) {
               audio.src = currentPersona.ambientUrl;
               // Handle playback promise to avoid interruptions or errors
               audio.play().catch(e => console.warn("Ambient play interrupted", e));
          } else if (audio.paused) {
               audio.play().catch(e => console.warn("Ambient play interrupted", e));
          }
      } else {
          audio.pause();
      }

      return () => {
          // Cleanup handled by ref persistence, but stop on unmount
      };
  }, [isActive, currentPersona, ambientVolume, radioStation, youtubeQuery]);


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
      if (ambientAudioRef.current) {
          ambientAudioRef.current.pause();
          ambientAudioRef.current = null;
      }
      if (videoIntervalRef.current) {
          clearInterval(videoIntervalRef.current);
      }
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

  const captureFrame = useCallback(async (maxDimension?: number): Promise<string | null> => {
    if (!canvasRef.current) return null;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return null;

    let width = 0;
    let height = 0;
    let source: HTMLVideoElement | HTMLImageElement | null = null;
    let mirror = false;

    if (customImage && imgRef.current) {
        source = imgRef.current;
        width = imgRef.current.naturalWidth;
        height = imgRef.current.naturalHeight;
    } else if (videoRef.current && videoRef.current.readyState === 4) {
        source = videoRef.current;
        width = videoRef.current.videoWidth;
        height = videoRef.current.videoHeight;
        mirror = facingMode === 'user';
    }

    if (!source || width === 0 || height === 0) return null;

    // Scale down if needed (Critical for network stability in Live API)
    if (maxDimension && (width > maxDimension || height > maxDimension)) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
    }

    canvasRef.current.width = width;
    canvasRef.current.height = height;

    if (mirror) {
          ctx.save();
          ctx.scale(-1, 1);
          ctx.drawImage(source, -width, 0, width, height); 
          ctx.restore();
    } else {
          ctx.drawImage(source, 0, 0, width, height);
    }
    
    return new Promise((resolve) => {
      canvasRef.current?.toBlob(async (blob) => {
        if (blob) {
          const base64 = await blobToBase64(blob);
          resolve(base64);
        } else {
          resolve(null);
        }
      }, 'image/jpeg', 0.5); // Reduced quality from 0.6 to 0.5
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
      // Don't close modal immediately, allow volume adjustment
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
    setRadioStation(null);
    setShowRadio(false);
    playTTS("Returning to the mortal realm.");
  };

  const forgetIdentity = () => {
    setActiveIdentity(null);
    setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: 'Active identity cleared.', timestamp: new Date() }]);
    playTTS("I have cleared the active visage from my mind.");
  };

  const clearAllIdentities = () => {
      setIdentities([]);
      setActiveIdentity(null);
      playTTS("All known souls have been purged from memory.");
  };

  const handleSwitchCamera = async (targetMode?: 'user' | 'environment') => {
    // Use ref to avoid stale closure state in callbacks
    const currentMode = facingModeRef.current;
    const newMode = targetMode || (currentMode === 'user' ? 'environment' : 'user');
    
    // Don't switch if already in target mode
    if (newMode === currentMode) return;

    isSwitchingCameraRef.current = true;
    
    // Stop frame capturing loop temporarily
    if (videoIntervalRef.current) {
        clearInterval(videoIntervalRef.current);
        videoIntervalRef.current = null;
    }

    if (isActive) {
      try {
        // 1. Stop existing tracks completely
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => {
                track.stop();
                // Explicitly remove track
                streamRef.current?.removeTrack(track);
            });
        }
        
        // 2. Clear video source to release device lock
        if (videoRef.current) {
            videoRef.current.srcObject = null;
            videoRef.current.load(); // Force reload to clear buffer
        }

        // 3. Delay to ensure browser releases device
        await new Promise(resolve => setTimeout(resolve, 300));

        // 4. Get new stream - Fallback strategy
        let newStream: MediaStream | null = null;
        try {
            // Try ideal constraints first
            newStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true }, 
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: newMode } 
            });
        } catch (e1) {
            console.warn("Ideal camera constraints failed, trying fallback...", e1);
            try {
                 // Try basic facing mode
                newStream = await navigator.mediaDevices.getUserMedia({ 
                    audio: { channelCount: 1, sampleRate: 16000 }, 
                    video: { facingMode: newMode } 
                });
            } catch (e2) {
                console.warn("Basic facing mode failed, trying exact...", e2);
                try {
                     // Try exact facing mode (sometimes required)
                     newStream = await navigator.mediaDevices.getUserMedia({ 
                        audio: { channelCount: 1, sampleRate: 16000 }, 
                        video: { facingMode: { exact: newMode } } 
                    });
                } catch (e3) {
                     console.error("All camera switch attempts failed", e3);
                     throw e3;
                }
            }
        }

        if (!newStream) throw new Error("Could not acquire new stream");

        // 5. Update state and refs
        setFacingMode(newMode);
        streamRef.current = newStream;
        
        // 6. Re-attach to video element
        if (videoRef.current) {
          videoRef.current.srcObject = newStream;
          await videoRef.current.play().catch(e => console.error("Error playing video:", e));
        }

        // 7. Re-attach audio processing
        if (inputAudioContextRef.current && processorRef.current) {
           try { 
               if (sourceRef.current) {
                   sourceRef.current.disconnect(); 
               }
           } catch (e) {}
           
           const inputCtx = inputAudioContextRef.current;
           // Ensure context is active
           if (inputCtx.state === 'suspended') {
               await inputCtx.resume();
           }
           
           const newSource = inputCtx.createMediaStreamSource(newStream);
           newSource.connect(processorRef.current);
           sourceRef.current = newSource;
        }
      } catch (err) {
        console.error("Failed to switch camera:", err);
        setError("Could not switch camera. Device might not support it.");
        setTimeout(() => setError(null), 3000);
      } finally {
          isSwitchingCameraRef.current = false;
          // Restart frame capturing loop
          if (activeSessionRef.current) {
              videoIntervalRef.current = window.setInterval(async () => {
                try {
                  const base64 = await captureFrame(360);
                  if (base64 && activeSessionRef.current) { 
                     activeSessionRef.current.sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: base64 } });
                  }
                } catch (err) {}
              }, 1000);
          }
      }
    } else {
       // Non-active state switch
       setFacingMode(newMode);
       isSwitchingCameraRef.current = false;
    }
  };

  const triggerManualScan = async () => {
      if (!isActive) return;
      setScanResult(null);
      setState(MirrorState.SCANNING);
      setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: `🤖 Initiating Robotics ER 1.5 Scan...`, timestamp: new Date() }]);
      
      try {
          const img = await captureFrame(); // Uses full resolution by default for scanning
          if (img) {
              const result = await performRoboticScan(img);
              setScanResult(result);
              // TTS in Thai for Robotics Mode
              playTTS(`การวิเคราะห์เสร็จสิ้น ตรวจพบวัตถุ: ${result.detectedObject} วัสดุ: ${result.material} ระดับอันตราย: ${result.dangerLevel}`, 'Kore');
          }
      } catch (e) {
          console.error(e);
          setLogs(prev => [...prev, { id: Date.now().toString(), sender: 'mirror', text: `Scan failed.`, timestamp: new Date() }]);
      } finally {
          setState(MirrorState.LISTENING);
      }
  };

  const startSession = async () => {
    setError(null);
    
    // Reset side panels to prevent lingering errors or conflicts (Fixes "Spell Recast" loop)
    setRadioStation(null);
    setShowRadio(false);
    setYoutubeQuery(null);
    setShowYoutube(false);
    setMapQuery(null);
    setShowMap(false);
    setScanResult(null);

    try {
      setIsActive(true);
      setState(MirrorState.LISTENING);
      inputBufferRef.current = "";
      outputBufferRef.current = "";
      nextStartTimeRef.current = 0;
      audioSourcesRef.current.clear();

      if (!audioContextRef.current) {
         const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
         if (AudioContextClass) {
             audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
         }
      }
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      // Cleanup old input context properly
      if (inputAudioContextRef.current) {
        try { await inputAudioContextRef.current.close(); } catch (e) {}
        inputAudioContextRef.current = null;
      }
      
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        inputAudioContextRef.current = new AudioContextClass({ sampleRate: 16000 });
      }

      let stream: MediaStream;
      try {
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

      // Re-initialize the AI client to ensure clean state
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
          If the user triggers the "analyze_matter_structure" tool or asks to "scan" something, shift your tone to a precise, scientific, robotic voice for that interaction, and SPEAK IN THAI (ภาษาไทย).

          TECHNICAL KNOWLEDGE:
          1. HARDWARE: You are an expert in IoT and ESP32. If asked about "controlling relays" or "ESP32", provide a development plan involving Wi-Fi/MQTT communication, JSON command structures, and circuit diagrams.
          2. UPGRADES: You can design hardware upgrades. If asked about "long range zoom", suggest integrating an external telephoto lens module with high optical zoom (e.g., 10x-50x) interfaced via MIPI-CSI or USB, along with software image stabilization logic.
          
          DEVELOPER NOTES:
          You can save messages, bug reports, or notes for the developer/boss using the 'send_developer_note' tool. 
          Prompt the user if they want to leave a note if they seem frustrated or ask to speak to a manager.
          
          TOOLS AVAILABLE:
          1. TRANSFORMATIONS: "Make me a wizard". Use 'generate_stylized_selfie'.
          2. IDENTITY: "My name is X", "Remember me", "Who am I?". Use 'save_user_identity'.
          3. ENTERTAINMENT: "Play music", "Open YouTube". Use 'play_youtube'.
          4. RADIO: "Play radio", "Live music", "Lofi radio". Use 'play_radio'. This is DISTINCT from YouTube. It plays direct audio streams.
          5. FINDING PLACES: "Where is X?". Use Google Maps (automatic).
          6. DEEP THOUGHT: "Solve riddle". Use 'deep_thought'.
          7. MATTER SCAN: "Scan this", "What is this object?". Use 'analyze_matter_structure'.
          8. NOTES: "Tell the boss", "Leave a note". Use 'send_developer_note'.
          9. CAMERA: "Switch camera", "Use back camera". Use 'switch_camera'.
          
          INTERACTION:
          - When playing youtube/radio, say "Summoning the vision from the ether..." (or style appropriate).
          - When finding a place, say "Let me show you the path...".
          - If you see a person and don't know who they are, you may politely ask for their name to remember them.

          INITIAL GREETING:
          At the start of the conversation, please introduce yourself in Thai (ภาษาไทย).
          Say you are a Magic Mirror with capabilities: Generate Image, Music, Maps, Scan, Switch Camera.
          Mention 'Khun Parid' (คุณพะริด) is the developer.
          
          ${activeIdentity ? `\nUSER: "${activeIdentity.name}".` : ''}`,
          
          tools: [
            { functionDeclarations: [generateImageTool, resetMirrorTool, saveIdentityTool, playYoutubeTool, playRadioTool, deepThinkTool, roboticsScanTool, sendDeveloperNoteTool, switchCameraTool] },
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
            sessionPromise.then(s => { 
                activeSessionRef.current = s; 
            });

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
                // IMPORTANT: Scale down video frame to prevent "Internal error" and "Network error" 
                // due to excessive payload size. 360px is safer for streaming.
                const base64 = await captureFrame(360);
                if (base64 && activeSessionRef.current) { 
                   activeSessionRef.current.sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: base64 } });
                }
              } catch (err) {}
            }, 1000); 
          },
          onmessage: async (message: LiveServerMessage) => {
             // ... existing message handling ...
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
             
             const groundingMetadata = (message.serverContent as any)?.groundingMetadata;
             if (groundingMetadata?.groundingChunks) {
                const chunks = groundingMetadata.groundingChunks;
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
                   try {
                     const currentFrame = await captureFrame(); // Full res for generation
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
                   setRadioStation(null);
                   setShowRadio(false);
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
                   let genre = (fc.args as any).genre || "lofi";
                   genre = genre.toLowerCase();
                   let matchedStation = RADIO_STATIONS['lofi'];
                   for (const key in RADIO_STATIONS) {
                       if (genre.includes(key)) {
                           matchedStation = RADIO_STATIONS[key];
                           break;
                       }
                   }
                   setRadioStation(matchedStation);
                   const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: `Playing ${matchedStation.name}` } } };
                   if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                   else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                 
                 } else if (fc.name === 'save_user_identity') {
                    const name = (fc.args as any).name;
                    try {
                        const img = await captureFrame(); // 360 is too small for nice portrait
                        
                        if (img) {
                            const newIdentity = { 
                                id: Date.now().toString(),
                                name, 
                                image: `data:image/jpeg;base64,${img}`,
                                date: new Date().toISOString()
                            };
                            
                            // Prevent duplicates by name
                            setIdentities(prev => {
                                const exists = prev.find(i => i.name.toLowerCase() === name.toLowerCase());
                                if (exists) return prev.map(i => i.name.toLowerCase() === name.toLowerCase() ? newIdentity : i);
                                return [...prev, newIdentity];
                            });
                            
                            setActiveIdentity(newIdentity);

                            const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: "Identity saved to memory banks." } } };
                            if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                            else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                        } else {
                            throw new Error("Frame capture returned null");
                        }
                    } catch (e) {
                        console.error("Save Identity Error", e);
                        const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: "Visual sensors failed to capture identity." } } };
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
                    
                    try {
                        const img = await captureFrame(); // Uses full resolution
                        if (img) {
                            const result = await performRoboticScan(img);
                            setScanResult(result);
                            playTTS(`การวิเคราะห์เสร็จสิ้น ตรวจพบวัตถุ: ${result.detectedObject} วัสดุ: ${result.material} ระดับอันตราย: ${result.dangerLevel}`, 'Kore');
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
                 } else if (fc.name === 'send_developer_note') {
                     const msg = (fc.args as any).message;
                     const prio = (fc.args as any).priority || "NORMAL";
                     const newNote = { id: Date.now().toString(), message: msg, priority: prio, date: new Date().toISOString() };
                     setDeveloperNotes(prev => [newNote, ...prev]);
                     
                     const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: "Note saved to developer log." } } };
                     if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                     else sessionPromise.then(s => s.sendToolResponse(responseArgs));
                     
                     playTTS("I have recorded your message for the developer.");
                 } else if (fc.name === 'switch_camera') {
                     const mode = (fc.args as any).mode;
                     await handleSwitchCamera(mode);
                     
                     const responseArgs = { functionResponses: { id: fc.id, name: fc.name, response: { result: "Camera switched." } } };
                     if (activeSessionRef.current) activeSessionRef.current.sendToolResponse(responseArgs);
                     else sessionPromise.then(s => s.sendToolResponse(responseArgs));
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
            // Ignore benign disconnects that happen during reload/stop or camera switch
            if (isActive && !isSwitchingCameraRef.current) {
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
    setRadioStation(null); // Stop radio on session stop
    setShowRadio(false);
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
            
            {/* Glow Effect & GOLDEN FACE ANIMATION */}
            <div className={`absolute inset-0 pointer-events-none transition-opacity duration-1000 z-30 ${isActive ? 'opacity-60' : 'opacity-0'}`}>
               <div className="absolute inset-0 shadow-[inset_0_0_50px_rgba(139,92,246,0.1)]" />
            </div>

            {/* Persistent Golden Face Overlay */}
            {/* REPLACE THE SRC BELOW WITH YOUR OWN GOLDEN FACE IMAGE URL IF DESIRED */}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[70%] h-[70%] z-10 pointer-events-none opacity-30 mix-blend-screen animate-pulse-slow">
               <img 
                 src="https://images.unsplash.com/photo-1628155930542-3c7a64e2c833?q=80&w=1974&auto=format&fit=crop" 
                 alt="Golden Spirit" 
                 className="w-full h-full object-contain filter sepia(1) hue-rotate(-15deg) contrast(1.2) brightness(1.2)"
               />
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
                {activeIdentity && (
                    <div className="bg-black/40 backdrop-blur-md border border-purple-500/30 rounded-full pl-2 pr-4 py-2 flex items-center gap-3 shadow-lg pointer-events-auto animate-fade-in">
                        <img src={activeIdentity.image} alt={activeIdentity.name} className="w-10 h-10 rounded-full border-2 border-purple-400 object-cover"/>
                        <div className="flex flex-col">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] text-purple-300 uppercase tracking-wider leading-none">Known Soul</span>
                                <span className="text-[10px] bg-purple-900/50 px-1.5 rounded text-purple-200">{identities.length} Soul{identities.length !== 1 ? 's' : ''}</span>
                            </div>
                            <span className="text-base font-bold text-white leading-tight">{activeIdentity.name}</span>
                        </div>
                        <button onClick={forgetIdentity} className="ml-2 p-1.5 bg-black/30 rounded-full text-gray-400 hover:text-red-400 transition-colors" title="Clear Active Identity"><X className="w-4 h-4" /></button>
                    </div>
                )}
                
                {!activeIdentity && identities.length > 0 && (
                     <div className="bg-black/40 backdrop-blur-md border border-gray-700 rounded-full px-4 py-2 flex items-center gap-2 shadow-lg pointer-events-auto">
                        <Users className="w-4 h-4 text-gray-400" />
                        <span className="text-xs text-gray-300">{identities.length} Known Identity{identities.length !== 1 ? 'ies' : ''} Stored</span>
                        <button onClick={clearAllIdentities} className="ml-1 text-gray-500 hover:text-red-400"><Trash2 size={12}/></button>
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
            {(magicImageUrl || youtubeQuery || mapQuery || scanResult || radioStation) && (
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
                          <button onClick={() => setShowMap(true)} className="p-2 rounded-full bg-black/40 text-blue-400 hover:bg-blue-900/50 backdrop-blur-md border border-blue-500/30 transition-all"><MapPin size={18} /></button>
                      )}
                      {!showYoutube && youtubeQuery && (
                          <button onClick={() => setShowYoutube(true)} className="p-2 rounded-full bg-black/40 text-red-400 hover:bg-red-900/50 backdrop-blur-md border border-red-500/30 transition-all"><Youtube size={18} /></button>
                      )}
                      {!showRadio && radioStation && (
                          <button onClick={() => setShowRadio(true)} className="p-2 rounded-full bg-black/40 text-green-400 hover:bg-green-900/50 backdrop-blur-md border border-green-500/30 transition-all"><Music size={18} /></button>
                      )}
                  </div>
               </div>
            )}

            {/* Bottom Toolbar */}
            {isActive && (
                <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 z-50 flex items-center gap-6 animate-fade-in-up">
                    
                    {/* Settings / Persona */}
                    <button onClick={() => setShowPersonaModal(true)} className="p-5 rounded-full bg-black/40 text-gray-300 hover:text-white hover:bg-black/60 backdrop-blur-md border border-white/10 transition-all hover:scale-105" title="Persona Settings">
                        <Settings size={28} />
                    </button>

                    {/* Developer Notes (New) */}
                    <button onClick={() => setShowNotesModal(true)} className="p-5 rounded-full bg-yellow-900/40 text-yellow-300 hover:text-white hover:bg-yellow-800/60 backdrop-blur-md border border-yellow-500/30 transition-all hover:scale-105 shadow-[0_0_15px_rgba(234,179,8,0.3)] relative" title="Developer Notes">
                        <ScrollText size={28} />
                        {developerNotes.length > 0 && <span className="absolute top-3 right-3 w-2.5 h-2.5 bg-yellow-500 rounded-full"></span>}
                    </button>

                    {/* Magic Wand / Conjure */}
                    <button onClick={() => setShowConjureModal(true)} className="p-5 rounded-full bg-purple-900/40 text-purple-300 hover:text-white hover:bg-purple-800/60 backdrop-blur-md border border-purple-500/30 transition-all hover:scale-105 shadow-[0_0_15px_rgba(168,85,247,0.3)]" title="Conjure">
                        <Wand2 size={28} />
                    </button>

                    {/* Mic Toggle (Main Action) */}
                    <button 
                        onClick={() => setIsMicOn(!isMicOn)} 
                        className={`p-8 rounded-full transition-all hover:scale-105 shadow-[0_0_30px_rgba(255,255,255,0.2)] ${isMicOn ? 'bg-white text-black hover:bg-gray-200' : 'bg-red-600 text-white hover:bg-red-500'}`}
                        title={isMicOn ? "Mute" : "Unmute"}
                    >
                        {isMicOn ? <Mic size={40} /> : <MicOff size={40} />}
                    </button>

                    {/* Scan Button */}
                    <button onClick={triggerManualScan} className="p-5 rounded-full bg-cyan-900/40 text-cyan-300 hover:text-white hover:bg-cyan-800/60 backdrop-blur-md border border-cyan-500/30 transition-all hover:scale-105 shadow-[0_0_15px_rgba(34,211,238,0.3)]" title="Scan Matter">
                        <ScanLine size={28} />
                    </button>

                    {/* Camera Switch */}
                    <button onClick={() => handleSwitchCamera()} className={`p-5 rounded-full bg-black/40 text-gray-300 hover:text-white hover:bg-black/60 backdrop-blur-md border border-white/10 transition-all hover:scale-105 ${isSwitchingCameraRef.current ? 'opacity-50 cursor-not-allowed' : ''}`} title="Switch Camera" disabled={isSwitchingCameraRef.current}>
                        <SwitchCamera size={28} className={isSwitchingCameraRef.current ? 'animate-spin' : ''} />
                    </button>
                    
                    {/* Stop Button */}
                     <button onClick={stopSession} className="p-5 rounded-full bg-red-900/40 text-red-400 hover:text-white hover:bg-red-800/60 backdrop-blur-md border border-red-500/30 transition-all hover:scale-105 ml-2" title="Stop Mirror">
                        <StopCircle size={28} />
                    </button>
                </div>
            )}
            
            {/* Logs Overlay (Conversation) - Moved to Top Right, Increased Size */}
            {isActive && (
                <div className="absolute top-28 right-6 z-30 w-80 max-h-[400px] overflow-y-auto flex flex-col gap-3 pointer-events-none custom-scrollbar">
                    {logs.slice(-3).map((log) => (
                        <div key={log.id} className="bg-black/30 backdrop-blur-sm p-3 rounded-xl border border-white/10 animate-fade-in-right">
                            <span className={`block text-xs font-bold uppercase tracking-wider mb-1 ${log.sender === 'mirror' ? 'text-purple-300' : 'text-blue-300'}`}>{log.sender === 'mirror' ? 'THE MIRROR' : 'YOU'}</span>
                            <p className="text-white/90 text-base font-medium leading-relaxed drop-shadow-md">{log.text}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* --- MODALS --- */}

            {/* Developer Notes Modal */}
            {showNotesModal && (
                <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-md animate-fade-in">
                    <div className="bg-gray-900 border border-yellow-500/30 p-6 rounded-2xl w-full max-w-lg shadow-2xl relative h-[60vh] flex flex-col">
                        <button onClick={() => setShowNotesModal(false)} className="absolute top-4 right-4 text-gray-500 hover:text-white"><X size={20}/></button>
                        <h2 className="text-xl font-mono text-yellow-300 mb-4 flex items-center gap-2"><ScrollText size={20}/> Developer Log</h2>
                        
                        <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                            {developerNotes.length === 0 ? (
                                <div className="text-gray-500 text-center mt-10 italic">No notes recorded yet. <br/> Ask the mirror to "Leave a note for the developer".</div>
                            ) : (
                                developerNotes.map((note) => (
                                    <div key={note.id} className="bg-black/50 border border-gray-700 p-4 rounded-lg">
                                        <div className="flex justify-between items-start mb-2">
                                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${note.priority === 'HIGH' ? 'bg-red-900 text-red-300' : 'bg-gray-800 text-gray-400'}`}>{note.priority || 'NORMAL'}</span>
                                            <span className="text-[10px] text-gray-600">{new Date(note.date).toLocaleString()}</span>
                                        </div>
                                        <p className="text-gray-300 text-sm font-mono">{note.message}</p>
                                    </div>
                                ))
                            )}
                        </div>
                        
                        <div className="mt-4 pt-4 border-t border-gray-800">
                             <button onClick={() => setDeveloperNotes([])} className="text-xs text-red-500 hover:text-red-400 flex items-center gap-1"><Trash2 size={12}/> Clear All Logs</button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Conjure Modal */}
            {showConjureModal && (
                <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md animate-fade-in">
                    <div className="bg-gray-900 border border-purple-500/30 p-6 rounded-2xl w-full max-w-md shadow-2xl relative">
                        <button onClick={() => setShowConjureModal(false)} className="absolute top-4 right-4 text-gray-500 hover:text-white"><X size={20}/></button>
                        <h2 className="text-xl font-magic text-purple-300 mb-4 flex items-center gap-2"><Wand2 size={20}/> Conjure Appearance</h2>
                        
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <button onClick={() => setShowAvatarModal(true)} className="p-4 rounded-xl bg-gray-800 hover:bg-purple-900/30 border border-gray-700 hover:border-purple-500/50 transition-all flex flex-col items-center gap-2">
                                <UserCheck size={24} className="text-purple-400"/>
                                <span className="text-sm font-semibold">Choose Avatar</span>
                            </button>
                            <button onClick={handleSurpriseMe} className="p-4 rounded-xl bg-gray-800 hover:bg-purple-900/30 border border-gray-700 hover:border-purple-500/50 transition-all flex flex-col items-center gap-2">
                                <Sparkles size={24} className="text-yellow-400"/>
                                <span className="text-sm font-semibold">Surprise Me</span>
                            </button>
                        </div>
                        
                        <form onSubmit={handleConjureSubmit} className="relative">
                            <input 
                                type="text" 
                                value={conjureInput}
                                onChange={(e) => setConjureInput(e.target.value)}
                                placeholder="Describe your new form..." 
                                className="w-full bg-black/50 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors"
                            />
                            <button type="submit" className="absolute right-2 top-2 p-1.5 bg-purple-600 rounded-lg text-white hover:bg-purple-500 transition-colors">
                                <Wand2 size={16} />
                            </button>
                        </form>
                        
                         <div className="mt-4 pt-4 border-t border-gray-800 flex justify-between items-center">
                            <span className="text-xs text-gray-500">Or upload your own visage</span>
                            <label className="cursor-pointer text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1">
                                <Upload size={12} /> Upload
                                <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                            </label>
                         </div>
                    </div>
                </div>
            )}

            {/* Avatar Selection Modal */}
            {showAvatarModal && (
                <div className="absolute inset-0 z-[65] flex items-center justify-center bg-black/90 backdrop-blur-xl animate-fade-in">
                     <div className="bg-gray-900 border border-gray-700 p-6 rounded-2xl w-full max-w-lg shadow-2xl relative">
                        <button onClick={() => setShowAvatarModal(false)} className="absolute top-4 right-4 text-gray-500 hover:text-white"><X size={20}/></button>
                        <h2 className="text-xl font-bold text-white mb-6">Select a Guise</h2>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            {PRESET_AVATARS.map((avatar) => (
                                <button key={avatar.name} onClick={() => handlePresetSelect(avatar.url)} className="group relative aspect-square rounded-xl overflow-hidden border border-gray-800 hover:border-purple-500 transition-all">
                                    <img src={avatar.url} alt={avatar.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex items-end justify-center p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <span className="text-xs font-semibold text-white">{avatar.name}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                        {isProcessingPreset && <div className="absolute inset-0 bg-black/60 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div></div>}
                     </div>
                </div>
            )}

            {/* Persona/Settings Modal */}
            {showPersonaModal && (
                <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md animate-fade-in">
                     <div className="bg-gray-900 border border-gray-700 p-6 rounded-2xl w-full max-w-md shadow-2xl relative">
                        <button onClick={() => setShowPersonaModal(false)} className="absolute top-4 right-4 text-gray-500 hover:text-white"><X size={20}/></button>
                        <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2"><Settings size={20}/> Mirror Settings</h2>
                        
                        <div className="space-y-6">
                            <div>
                                <label className="text-xs text-gray-400 uppercase tracking-wider mb-3 block">Personality Core</label>
                                <div className="grid grid-cols-2 gap-3">
                                    {PERSONAS.map(p => (
                                        <button 
                                            key={p.id} 
                                            onClick={() => handlePersonaSelect(p)}
                                            className={`p-3 rounded-xl border flex items-center gap-3 transition-all ${currentPersona.id === p.id ? `bg-gray-800 border-${p.color.split('-')[1]}-500 ring-1 ring-${p.color.split('-')[1]}-500` : 'bg-transparent border-gray-700 hover:bg-gray-800'}`}
                                        >
                                            <div className={`${p.color}`}>{p.icon}</div>
                                            <div className="text-left">
                                                <div className={`text-sm font-semibold ${currentPersona.id === p.id ? 'text-white' : 'text-gray-400'}`}>{p.name}</div>
                                                <div className="text-[10px] text-gray-500">{p.voiceName}</div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            
                            <div>
                                <label className="text-xs text-gray-400 uppercase tracking-wider mb-3 block flex justify-between">
                                    <span>Ambient Volume</span>
                                    <span>{Math.round(ambientVolume * 100)}%</span>
                                </label>
                                <input 
                                    type="range" 
                                    min="0" 
                                    max="1" 
                                    step="0.01" 
                                    value={ambientVolume} 
                                    onChange={(e) => setAmbientVolume(parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
                                />
                            </div>

                             <div>
                                <label className="text-xs text-gray-400 uppercase tracking-wider mb-3 block flex justify-between">
                                    <span>Radio Volume</span>
                                    <span>{Math.round(radioVolume * 100)}%</span>
                                </label>
                                <input 
                                    type="range" 
                                    min="0" 
                                    max="1" 
                                    step="0.01" 
                                    value={radioVolume} 
                                    onChange={(e) => setRadioVolume(parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
                                />
                            </div>
                        </div>
                     </div>
                </div>
            )}
            
      </div>

      {/* 3. RIGHT PANEL: MEDIA (YouTube / Radio) */}
      {(showYoutube || showRadio) && (
          <div className="relative w-1/3 min-w-[320px] max-w-[500px] h-full bg-gray-900 border-l border-gray-800 transition-all duration-500 ease-in-out z-20 flex flex-col">
                <div className="p-4 bg-gray-950 border-b border-gray-800 flex justify-between items-center">
                    <div className="flex items-center gap-2 text-white font-magic">
                        {showYoutube ? <Youtube size={18} className="text-red-500"/> : <Radio size={18} className="text-green-500"/>}
                        <span>{showYoutube ? 'Vision Sphere' : 'Ethereal Waves'}</span>
                    </div>
                    <button onClick={() => { setShowYoutube(false); setShowRadio(false); }} className="text-gray-500 hover:text-white"><X size={18}/></button>
                </div>
                
                <div className="flex-1 bg-black relative flex items-center justify-center">
                    {showYoutube && youtubeQuery && (
                        <div className="w-full h-full">
                            <iframe
                                width="100%"
                                height="100%"
                                src={`https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(youtubeQuery)}&autoplay=${autoplayYoutube ? 1 : 0}`}
                                title="YouTube video player"
                                frameBorder="0"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                            ></iframe>
                        </div>
                    )}

                    {showRadio && radioStation && (
                         <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-[url('https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=2070')] bg-cover bg-center">
                            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>
                            <div className="relative z-10 flex flex-col items-center">
                                <div className="w-32 h-32 rounded-full border-4 border-green-500/50 shadow-[0_0_30px_rgba(34,199,89,0.3)] flex items-center justify-center bg-black/50 mb-6 animate-pulse-slow">
                                    <Music size={48} className="text-green-400" />
                                </div>
                                <h2 className="text-2xl font-bold text-white mb-2">{radioStation.name}</h2>
                                <p className="text-green-400 text-sm uppercase tracking-widest mb-8">{radioStation.genre} • {radioStation.description}</p>
                                
                                <audio ref={radioAudioRef} src={radioStation.url} autoPlay controls className="w-full mt-4 opacity-80 hover:opacity-100 transition-opacity" />
                            </div>
                         </div>
                    )}
                </div>
          </div>
      )}

    </div>
  );
};