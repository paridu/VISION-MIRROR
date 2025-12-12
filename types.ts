export enum MirrorState {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  CASTING_SPELL = 'CASTING_SPELL', // Generating image
  SPEAKING = 'SPEAKING',
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
