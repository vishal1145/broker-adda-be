import mongoose from "mongoose";

export const TASK_TYPES = Object.freeze({
  BOT_REPLY: "BOT_REPLY"
});

const scheduledTaskSchema = new mongoose.Schema(
  {
    taskType: {
      type: String,
      enum: Object.values(TASK_TYPES),
      required: true
    },
    runAt: {
      type: Date,
      required: true
    },
    payload: {
      chatId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Chat",
        required: true
      }
    },
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed"],
      default: "pending"
    },
    lastRunAt: {
      type: Date
    },
    errorMessage: {
      type: String
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);




export default mongoose.model("ScheduledTask", scheduledTaskSchema);
