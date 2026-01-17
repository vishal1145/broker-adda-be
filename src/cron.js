import cron from 'node-cron';
import mongoose from 'mongoose';
import { getNextPendingTask, updateTaskById }  from './services/scheduledTask.service.js';
import { sendBotMessage } from './services/sendMessageToUser.js';
import { getLastMessageTextFromChatId } from './services/message.service.js';



let isRunning = false;
const isDev = false

const log = (...args) => {
  if (isDev) console.log(...args);
};

const errorLog = (...args) => {
  if (isDev) console.error(...args);
};



export const startCronJob = () => {
  cron.schedule('* * * * *', async () => {
    if (isRunning) return;
    isRunning = true;

    log('⏳ Cron job started...');
    let task = null;

    try {
      // 1️⃣ Get next pending task
      task = await getNextPendingTask();
      if (!task) return;

      // 2️⃣ Mark task as processing
      await updateTaskById(task._id, {
        status: 'processing',
        startedAt: new Date()
      });

      log('📌 Processing task:', task._id.toString());

      // 3️⃣ Execute task
      if (task.taskType === 'BOT_REPLY') {
        const { chatId } = task.payload;

        if (!mongoose.Types.ObjectId.isValid(chatId)) {
          throw new Error('Invalid chatId in task payload');
        }

        // fetch last message
        const { from, to, text, userLanguage } =
          await getLastMessageTextFromChatId(chatId);

        // swap from & to
        await sendBotMessage({
          chatId,
          from: to,
          to: from,
          text,
          userLanguage
        });
      }

      // 4️⃣ Mark task completed
      await updateTaskById(task._id, {
        status: 'completed',
        completedAt: new Date()
      });

      log('✅ Task completed:', task._id.toString());

    } catch (err) {
      errorLog('❌ Cron job error:', err.message);

      if (task?._id) {
        await updateTaskById(task._id, {
          status: 'failed',
          errorMessage: err.message,
          failedAt: new Date()
        });
      }

    } finally {
      isRunning = false;
    }
  });
};

