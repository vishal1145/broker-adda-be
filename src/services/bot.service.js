import axios from "axios";

const BASE_URL = "https://botservice-be.algofolks.com/api/estate";

export async function sendEstateMessage({ question, brokerId = "broker_001", language, sessionId }) {
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
        language:language
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