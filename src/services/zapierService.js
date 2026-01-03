import axios from "axios";

export const sendToZapier = async (webhookUrl, payload) => {
  if (!webhookUrl) return;
  // console.log("Webhook URL: ", webhookUrl);
  // console.log("Payload: ", payload);

  try {
    await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 3500,
    });
  } catch (err) {
    console.error("Zapier webhook failed:", err.message);
  }
};
