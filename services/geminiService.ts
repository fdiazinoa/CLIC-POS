
import { GoogleGenAI } from "@google/genai";
import { CartItem, BusinessConfig } from "../types";

const createClient = () => {
  if (!process.env.API_KEY) return null;
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

  const verticalContext = config.vertical === 'RESTAURANT'
    ? "Eres un asistente experto para meseros en un restaurante."
    : "Eres un asistente experto en ventas retail.";

  const prompt = `
    ${verticalContext}
    El cliente tiene esto en su carrito: ${cartDescription || "Carrito vacío"}.
    Tipo de negocio: ${config.subVertical}.
    
    Dame 2 sugerencias breves y directas de "Upsell" (venta adicional) o "Cross-sell" (venta cruzada) que el vendedor pueda decir al cliente. 
    Mantén el tono profesional pero persuasivo.
    Formato: Solo devuelve el texto de la sugerencia, separado por guiones. Máximo 30 palabras.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
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

  const prompt = `
    Analiza esta transacción rápida:
    Total: ${config.currencySymbol}${salesData.total.toFixed(2)}
    Items: ${salesData.itemCount}
    Negocio: ${config.subVertical}
    
    Dame un mensaje motivacional muy corto (1 frase) para el cajero/vendedor.
  `;

   try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text || "¡Buena venta!";
  } catch (error) {
    return "¡Sigue así!";
  }
}
