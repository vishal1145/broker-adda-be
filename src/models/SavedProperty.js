import mongoose from 'mongoose';

const savedPropertySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
      index: true
    }
  },
  { timestamps: true }
);

// Compound index to ensure one user can't save the same property twice
savedPropertySchema.index({ userId: 1, propertyId: 1 }, { unique: true });

export default mongoose.model('SavedProperty', savedPropertySchema);

