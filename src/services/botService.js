import axios from "axios";

const BASE_URL = "https://botservice-be.algofolks.com/api/estate";

/**
 * Send user message to Estate Bot
 * @param {Object} params
 * @param {string} params.question - User message
 * @param {string} params.brokerId - Selected broker id
 * @param {string} params.sessionId - Chat session id
 * @returns {Promise<Object>} Assistant response
 */

export async function sendEstateMessage({ question, brokerId = "broker_001", sessionId="reqe452354a" }) {
  if (!question) {
    throw new Error("question is required");
  }
  if (!brokerId) {
    throw new Error("brokerId is required");
  }
  if (!sessionId) {
    throw new Error("sessionId is required");
  }

  try {
    const response = await axios.post(
      `${BASE_URL}/ask`,
      {
        question,
        brokerId,
      },
      {
        params: { sessionId },
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 150000,
      }
    );

    return response.data;
  } catch (error) {
    console.error("Estate chat API error:", error);
    throw error;
  }
}
