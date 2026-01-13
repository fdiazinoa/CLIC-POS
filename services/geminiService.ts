
import { GoogleGenAI } from "@google/genai";
import { CartItem, BusinessConfig } from "../types";

// Helper to initialize GoogleGenAI client using pre-configured API key from environment
const createClient = () => {
  if (!process.env.API_KEY) return null;
  // Always use a named parameter when initializing GoogleGenAI
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const getSmartSuggestions = async (
  cart: CartItem[],
  config: BusinessConfig
): Promise<string> => {
  const ai = createClient();
  if (!ai) return "Configura tu API Key para sugerencias inteligentes.";

  const cartDescription = cart
    .map((item) => `${item.quantity}x ${item.name}`)
    .join(", ");

  // Context is now provided via systemInstruction for better clarity and response quality
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `El cliente tiene esto en su carrito: ${cartDescription || "Carrito vacío"}. Tipo de negocio: ${config.subVertical}. Dame 2 sugerencias breves y directas de "Upsell" (venta adicional) o "Cross-sell" (venta cruzada) que el vendedor pueda decir al cliente. Mantén el tono profesional pero persuasivo. Formato: Solo devuelve el texto de la sugerencia, separado por guiones. Máximo 30 palabras.`,
      config: {
        systemInstruction: config.vertical === 'RESTAURANT'
          ? "Eres un asistente experto para meseros en un restaurante."
          : "Eres un asistente experto en ventas retail.",
      },
    });
    // Safely accessing the .text property from GenerateContentResponse
    return response.text || "No hay sugerencias disponibles.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Error al conectar con el asistente inteligente.";
  }
};

export const analyzeSalesContext = async (
  salesData: { total: number, itemCount: number },
  config: BusinessConfig
): Promise<string> => {
  const ai = createClient();
  if (!ai) return "";

  // Moving task instruction to systemInstruction for better compliance with structured prompting
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Transacción: Total: ${config.currencySymbol}${salesData.total.toFixed(2)}, Items: ${salesData.itemCount}, Negocio: ${config.subVertical}. Genera un mensaje motivacional.`,
      config: {
        systemInstruction: "Eres un mentor motivacional para equipos de ventas. Tu tarea es analizar la transacción y dar un mensaje motivacional muy corto (1 frase) para el cajero/vendedor.",
      },
    });
    // Safely accessing the .text property from GenerateContentResponse
    return response.text || "¡Buena venta!";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "¡Sigue así!";
  }
}
