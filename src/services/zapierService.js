import axios from "axios";

export const sendToZapier = async (webhookUrl, payload) => {
  if (!webhookUrl) return;

  try {
    await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 3000,
    });
  } catch (err) {
    console.error("Zapier webhook failed:", err.message);
  }
};
