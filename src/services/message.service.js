import Message from '../models/Message.js';
import mongoose from 'mongoose';
import Chat from '../models/Chat.js';


export async function getMessageWithLast10(chatId) {
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw new Error('Invalid messageId');
  }

  // 1️⃣ Get the current message
  const message = await Message.findById({chatId})
    .select('chatId from to text role createdAt')
    .lean();

  if (!message) {
    throw new Error('Message not found');
  }

  // 2️⃣ Get last 10 messages of the same chat (excluding current one)
  const last10Messages = await Message.find({
    chatId: chatId,
    _id: { $ne: message._id }
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .select('from to text role createdAt')
    .lean();

  return {
    from: message.from,
    to: message.to,
    text: message.text,
    role: message.role,
    last10Messages: last10Messages.reverse()
  };
}

export async function createMessage({
  chatId,
  from,
  to,
  role = 'user',
  text = '',
  content = [],
  attachments = [],
  leadCards = [],
  sessionId = null
}) {
  try {
    const msg = await Message.create({
      chatId,
      from,
      to,
      role,
      text,
      content,
      attachments,
      leadCards,
      sessionId
    });

    return msg;

  } catch (error) {
    console.error('❌ createMessage error:', error);
    // rethrow so caller can handle it
    throw new Error(
      error?.message || 'Failed to create message'
    );
  }
}

export async function getLastMessageTextFromChatId(chatId) {
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw new Error('Invalid chatId');
  }
  const chat = await Chat.findById(chatId)
    .select('lastMessage')
    .lean();
  if (!chat?.lastMessage) return null;
  const message = await Message.findOne({ _id: chat.lastMessage, role: 'user' })
    .select('text role createdAt from to userLanguage')
    .lean();
  return message || null;
}