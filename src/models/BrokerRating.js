import mongoose from 'mongoose';

const brokerRatingSchema = new mongoose.Schema(
  {
    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BrokerDetail',
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator: Number.isInteger,
        message: 'Rating must be an integer between 1 and 5'
      }
    },
    review: {
      type: String,
      trim: true,
      maxlength: [1000, 'Review cannot be more than 1000 characters']
    }
  },
  { timestamps: true }
);

// Compound index to prevent duplicate ratings from same user to same broker
brokerRatingSchema.index({ brokerId: 1, userId: 1 }, { unique: true });

// Index for efficient queries by broker
brokerRatingSchema.index({ brokerId: 1, rating: 1 });

export default mongoose.model('BrokerRating', brokerRatingSchema);

