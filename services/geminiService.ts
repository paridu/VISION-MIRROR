import { GoogleGenAI, Modality, Type } from "@google/genai";
import { ScanResult } from "../types";

// Helper to get client instance safely
const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY is missing");
  }
  return new GoogleGenAI({ apiKey });
};

export const generateMagicImage = async (
  currentFrameBase64: string,
  prompt: string
): Promise<string> => {
  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: currentFrameBase64,
            },
          },
          {
            text: `You are a magic mirror artist. Transform this person's image based on this request: "${prompt}". 
            Keep the composition similar but change the style, costume, and atmosphere completely to match the request. 
            High quality, fantasy art style, detailed.`,
          },
        ],
      },
      config: {} 
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    
    throw new Error("No image generated");
  } catch (error) {
    console.error("Magic generation failed:", error);
    throw error;
  }
};

export const generateAvatarFromText = async (prompt: string): Promise<string> => {
  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: `Generate a high quality, portrait based on this description: "${prompt}". 
            The image should be centered, facing forward, suitable for a profile picture or mirror reflection.
            Photorealistic or high quality art style.`,
          },
        ],
      },
      config: {}
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    
    throw new Error("No image generated");
  } catch (error) {
    console.error("Avatar generation failed:", error);
    throw error;
  }
};

export const generateSpeech = async (text: string, voiceName: string): Promise<string> => {
  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: { parts: [{ text }] },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceName || 'Charon' },
          },
        },
      },
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) throw new Error("No audio generated");
    return audioData;
  } catch (error) {
    console.error("Speech generation failed:", error);
    throw error;
  }
};

export const performRoboticScan = async (currentFrameBase64: string): Promise<ScanResult> => {
  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: currentFrameBase64,
            },
          },
          {
            text: `Analyze this image using robotic entity reasoning (simulating gemini-robotics-er-1.5). 
            Identify the primary object or entity in the frame.
            Return a JSON object with:
            - detectedObject: Short name of the object.
            - material: Primary material composition.
            - functionality: Brief description of its utility or purpose.
            - dangerLevel: A percentage string (e.g., "5%", "90%") and brief reason.
            - probability: Confidence score (0-100).
            Only return the JSON.`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedObject: { type: Type.STRING },
            material: { type: Type.STRING },
            functionality: { type: Type.STRING },
            dangerLevel: { type: Type.STRING },
            probability: { type: Type.NUMBER },
          },
        }
      } 
    });

    const text = response.text;
    if (!text) throw new Error("Analysis failed");
    return JSON.parse(text) as ScanResult;
  } catch (error) {
    console.error("Robotic scan failed:", error);
    throw error;
  }
};