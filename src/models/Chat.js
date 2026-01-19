import mongoose from 'mongoose';
const chatSchema = new mongoose.Schema({
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    participantsKey: { type: String, unique: true },
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    unreadCounts: { type: Map, of: Number }
  }, { timestamps: true });
  
  export default mongoose.model('Chat', chatSchema);
  