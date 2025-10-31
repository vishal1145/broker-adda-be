import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema({
  url: String,
  filename: String,
  mimeType: String,
  size: Number
}, { _id: false });

const leadCardSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  customerName: String,
  budget: Number,
  customerPhone: String,
  transfers: Array,
  status: String,
}, { _id: false });

const messageSchema = new mongoose.Schema({
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, default: '' },
  attachments: [attachmentSchema],
  leadCards: [leadCardSchema],
  status: {
    type: String,
    enum: ['sent','delivered','read'],
    default: 'sent'
  },
  isDeletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

export default mongoose.model('Message', messageSchema);
