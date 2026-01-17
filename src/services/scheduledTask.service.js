import ScheduledTask from "../models/ScheduledTask.js";
import { TASK_TYPES } from "../models/ScheduledTask.js";
import mongoose from "mongoose";
import runAfterMinutes from "../utils/runAfterMinutes.js";
// import connectDB from "../config/db.js";
// import dotenv from "dotenv"
// dotenv.config();


export const createBotReplyTask = async ({
  chatId,
  time
}) => {

  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw new Error("Invalid chatId");
  }

  const task = await ScheduledTask.create({
    taskType: TASK_TYPES.BOT_REPLY,
    runAt : runAfterMinutes(time),
    payload: { chatId },
    status: "pending",
    isActive: true
  });

  return task;
};


// await createBotReplyTask({
//   chatId,
//   time 
// });


export const updateTaskById = async (taskId, updates) => {
  if (!mongoose.Types.ObjectId.isValid(taskId)) {
    throw new Error("Invalid taskId");
  }

  const task = await ScheduledTask.findByIdAndUpdate(
    taskId,
    { $set: updates },
    { new: true }
  );

  return task;
};


// await updateTaskById(taskId, {
//   status: "completed",
//   lastRunAt: new Date()
// });



export const getNextPendingTask = async () => {
  const now = new Date();

  const task = await ScheduledTask.findOne({
    status: "pending",
    isActive: true,
    runAt: { $lte: now }
  })
    .sort({ runAt: 1 }) // earliest first
    .lean();

  return task;
};


// const task = await getNextPendingTask();
// if (!task) return;


// (async()=>{
//   await connectDB();
//   let response = await getNextPendingTask();
//   console.log(response);
// })()