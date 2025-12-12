import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateMagicImage = async (
  currentFrameBase64: string,
  prompt: string
): Promise<string> => {
  try {
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
      // Config for generation - thinkingConfig is not supported for image models
      config: {} 
    });

    // Extract image
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
      // Config for generation - thinkingConfig is not supported for image models
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