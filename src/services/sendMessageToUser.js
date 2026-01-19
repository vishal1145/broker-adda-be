import Chat from '../models/Chat.js';
import { getIO } from '../utils/socket.js';
import { createNotification } from '../utils/notifications.js';
import User from '../models/User.js';
import { sendEstateMessage } from './bot.service.js';
import Message from '../models/Message.js';


export async function sendBotMessage({
  chatId,
  from,
  to,
  text,
  content = [],
  attachments = [],
  leadCards = [],
  sessionId = null,
  userLanguage
}) {
  const io = getIO();

  //generate bot response 
  const botReply = await sendEstateMessage({
    question: text,
    language:  userLanguage,
    sessionId: chatId
  });

  // 1️⃣ Save message
  if (!botReply?.content?.length) return;
  const botText = botReply.content.find(c => c.type === 'text')?.text || '';
  const msg = await Message.create({
    chatId: chatId,
    from,
    to,
    role: 'assistant',
    text: botText,
    content: botReply.content,
    sessionId: chatId,
    attachments: [],
    leadCards: []
  });


  const data = {chatId,from,to,text,content, attachments ,leadCards,sessionId}

  // 2️⃣ Update chat
  await Chat.findByIdAndUpdate(chatId, {
    lastMessage: msg._id,
    $inc: { [`unreadCounts.${to}`]: 1 }
  });

  // Create notification for new message (non-blocking - fire and forget)
  // Don't await - let it run in background so socket message is sent immediately
  (async () => {
    try {
      const fromUser = await User.findById(from).select('name');
      await createNotification({
        userId: data.to,
        type: 'message',
        title: 'New Message',
        message: fromUser?.name 
          ? `You have a new message from ${fromUser.name}${data.text ? `: ${data.text.substring(0, 50)}${data.text.length > 50 ? '...' : ''}` : ''}`
          : `You have a new message${data.text ? `: ${data.text.substring(0, 50)}${data.text.length > 50 ? '...' : ''}` : ''}`,
        priority: 'medium',
        relatedEntity: {
          entityType: 'Message',
          entityId: msg._id
        },
        activity: {
          action: 'sent',
          actorId: from,
          actorName: fromUser?.name
        },
        metadata: {
          chatId: data.chatId,
          messageId: msg._id,
          hasAttachments: (data.attachments || []).length > 0,
          hasLeadCards: (data.leadCard || []).length > 0
        }
      });

    } catch (notifError) {
      console.error('Error creating message notification:', notifError);
    }
  })();
  
  // 3️⃣ Emit socket events
  io.to(`user_${to}`).emit('message', msg);
  io.to(`chat_${chatId}`).emit('message', msg);
  return msg;
}