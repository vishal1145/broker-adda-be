import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, 
  planType: { type: String, required: true }, // e.g. 'basic' | 'premium'
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },

  // period definition; default monthly
  periodValue: { type: Number, default: 1 }, // e.g., 1
  periodUnit: { type: String, enum: ['day','week','month','year'], default: 'month' },

  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },

  status: { type: String, enum: ['active','expired','cancelled','pending'], default: 'pending' },

  // link to payment (one-off payment that created/renewed this subscription)
  paymentRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },

  autoRenew: { type: Boolean, default: false },
}, { timestamps: true });

subscriptionSchema.index({ user: 1, status: 1 });
subscriptionSchema.index({ endDate: 1 });

export default mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);
