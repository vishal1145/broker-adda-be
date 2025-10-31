import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import mongoose from 'mongoose';
import BrokerDetail from '../models/BrokerDetail.js';

function makeParticipantsKey(ids) {
    return ids.map(id => id.toString()).sort().join('_');
}

export const createChat = async (req, res) => {
    try {
        let { participants } = req.body;
        console.log('participants',participants)
        console.log('req.user._id.toString()', req.user._id.toString())
        if (!Array.isArray(participants) || participants.length < 2) {
            return res.status(400).json({ error: 'participants array required (2 or more)' });
        }

        participants = Array.from(new Set(participants.map(id => new mongoose.Types.ObjectId(id).toString())));

        // const requesterId = req.user._id.toString();
        // if (!participants.includes(requesterId)) {
        //     return res.status(403).json({ error: 'Requester must be included in participants' });
        // }

        const participantsKey = makeParticipantsKey(participants);

        const chat = await Chat.findOneAndUpdate(
            { participantsKey },
            {
                $setOnInsert: {
                    participants: participants.map(id => new mongoose.Types.ObjectId(id)),
                    participantsKey
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();

        return res.json({ chatId: chat._id, chat });
    } catch (err) {
        console.error('POST /api/chats error:', err);
        if (err.code === 11000) {
            try {
                const participantsKey = makeParticipantsKey(req.body.participants || []);
                const existing = await Chat.findOne({ participantsKey }).lean();
                if (existing) return res.json({ chatId: existing._id, chat: existing });
            } catch (e) { /* fallthrough */ }
        }
        return res.status(500).json({ error: 'Server error' });
    }
}

export const getChatMessages = async (req, res) => {
    try {
      const { chatId } = req.params;
  
      if (!chatId) {
        return res.status(400).json({ error: 'Chat ID required' });
      }
  
      const messages = await Message.find({ chatId })
        .sort({ createdAt: 1 }) 
        .lean();
  
      return res.status(200).json({ success: true, messages });
    } catch (error) {
      console.error('Error fetching messages:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
};

export const getMyChats = async (req, res) => {
    try {
      const userId = req.user._id; 
      const broker = await BrokerDetail.findOne({ userId: userId });

      const chats = await Chat.find({ participants: new mongoose.Types.ObjectId(broker._id) })
        .sort({ updatedAt: -1 })
        .populate({
          path: 'lastMessage',
          select: 'text from to createdAt',
          populate: { path: 'from', select: 'name brokerImage' } 
        })
        .lean();
  
      // For each chat get the other participant(s) info (for 1:1 this is simple)
      const response = await Promise.all(chats.map(async (chat) => {
        // find other participant(s)
        const others = chat.participants.filter(p => String(p) !== String(broker._id));

        console.log('others', others);
        // If participants are objectIds, populate broker detail manually:
        // You can use Broker model to fetch details in batch — here quick approach:
        const brokers = [];
        for (const pid of others) {
          const b = await BrokerDetail.findById(pid).select('name firmName brokerImage status').lean();
          if (b) brokers.push(b);
        }
  
        // unread count for this user
        const unreadCount = chat.unreadCounts?.[userId] || 0;
  
        return {
          chatId: chat._id,
          participants: brokers, // array of other brokers (usually 1)
          lastMessage: chat.lastMessage || null,
          updatedAt: chat.updatedAt,
          unreadCount
        };
      }));
  
      return res.json({ success: true, data: response });
    } catch (err) {
      console.error('GET /api/chats error', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };