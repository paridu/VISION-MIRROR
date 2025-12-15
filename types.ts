export enum MirrorState {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  CASTING_SPELL = 'CASTING_SPELL', // Generating image
  SPEAKING = 'SPEAKING',
  SCANNING = 'SCANNING', // New state for robotics scan
}

export interface MagicLog {
  id: string;
  sender: 'user' | 'mirror';
  text: string;
  timestamp: Date;
}

export interface GeneratedImage {
  url: string;
  prompt: string;
}

export interface ScanResult {
  detectedObject: string;
  material: string;
  functionality: string;
  dangerLevel: string;
  probability: number;
}

export interface Persona {
  id: string;
  name: string;
  voiceName: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  systemInstruction: string;
  icon: any; // React Node
  color: string;
  ambientUrl: string; // Background sound URL
}