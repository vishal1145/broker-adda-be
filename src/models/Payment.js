import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  razorpayOrderId: { type: String, required: true, index: true },
  razorpayPaymentId: { type: String, required: true, unique: true },
  razorpaySignature: { type: String, required: true },
  amount: { type: Number, required: true }, // in paise
  currency: { type: String, default: 'INR' },
  status: { type: String, default: 'created' }, // created, captured, failed, refunded
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } // optional link
}, { timestamps: true });

export default mongoose.models.Payment || mongoose.model('Payment', paymentSchema);
