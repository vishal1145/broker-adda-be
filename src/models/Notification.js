import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User', 
      required: true,
      index: true 
    },
    type: {
      type: String,
      enum: ['lead', 'property', 'message', 'system', 'transfer', 'approval', 'other'],
      required: true
    },
    title: { 
      type: String, 
      required: true 
    },
    message: { 
      type: String, 
      required: true 
    },
    isRead: { 
      type: Boolean, 
      default: false,
      index: true 
    },
    relatedEntity: {
      entityType: {
        type: String,
        enum: ['Lead', 'Property', 'Message', 'Chat', 'BrokerDetail', 'CustomerDetail']
      },
      entityId: {
        type: mongoose.Schema.Types.ObjectId
      }
    },
    activity: {
      action: String, // e.g., 'created', 'updated', 'transferred', 'approved'
      actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      actorName: String
    },


    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },


  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);

