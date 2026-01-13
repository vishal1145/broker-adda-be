// import mongoose from 'mongoose';

// const attachmentSchema = new mongoose.Schema({
//   url: String,
//   filename: String,
//   mimeType: String,
//   size: Number
// }, { _id: false });

// const leadCardSchema = new mongoose.Schema({
//   _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
//   customerName: String,
//   budget: Number,
//   customerPhone: String,
//   transfers: Array,
//   status: String,
// }, { _id: false });

// const messageSchema = new mongoose.Schema({
//   chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
//   from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
//   to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
//   text: { type: String, default: '' },
//   attachments: [attachmentSchema],
//   leadCards: [leadCardSchema],
//   status: {
//     type: String,
//     enum: ['sent','delivered','read'],
//     default: 'sent'
//   },
//   isDeletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
// }, { timestamps: true });

// export default mongoose.model('Message', messageSchema);



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

/**
 * 🔹 AI / Rich Content Block
 */
const contentBlockSchema = new mongoose.Schema({
  type: { type: String, default: 'text' }, // text, image, table, list etc.
  text: { type: String, default: '' },
  ordered: { type: Boolean, default: false },
  items: { type: Array, default: [] },
  language: { type: String, default: '' },
  content: { type: String, default: '' },
  url: { type: String, default: '' },
  caption: { type: String, default: '' },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  image: { type: String, default: '' },
  headers: { type: Array, default: [] },
  rows: { type: Array, default: [] }
}, { _id: false });

const messageSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true
  },

  from: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  to: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  /**
   * 🔹 Simple text (used by UI, search, notifications)
   */
  text: {
    type: String,
    default: ''
  },

  /**
   * 🔹 Structured / AI message
   */
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    default: 'user'
  },

  content: {
    type: [contentBlockSchema],
    default: []
  },

  sessionId: {
    type: String,
    index: true
  },

  attachments: [attachmentSchema],
  leadCards: [leadCardSchema],

  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },

  isDeletedFor: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]

}, { timestamps: true });

export default mongoose.model('Message', messageSchema);