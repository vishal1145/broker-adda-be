import mongoose from 'mongoose';

const emailSubscriptionSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      unique: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    status: {
      type: String,
      enum: ['active', 'unsubscribed', 'bounced'],
      default: 'active'
    },
    subscribedAt: {
      type: Date,
      default: Date.now
    }

  },
  { timestamps: true }
);

emailSubscriptionSchema.index({ email: 1 });
emailSubscriptionSchema.index({ status: 1 });

export default mongoose.model('EmailSubscription', emailSubscriptionSchema);

