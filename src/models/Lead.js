import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema(
  {
    // Basic customer details
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    customerEmail: { type: String },
    requirement: { type: String, required: true }, 
    propertyType: { type: String, enum: ["Residential", "Commercial", "Plot", "Other"], required: true },
    budget: { type: Number },
    region: { type: mongoose.Schema.Types.ObjectId, ref: 'Region', required: true },

    // Lead ownership
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'BrokerDetail', required: true },

    // Lead lifecycle
    status: {
      type: String,
      enum: ["New", "Assigned", "In Progress", "Closed", "Rejected"],
      default: "New",
    },

    // Transfer workflow (multiple brokers at once)
    transfers: [
      {
        fromBroker: { type: mongoose.Schema.Types.ObjectId, ref: 'BrokerDetail', required: true },
        toBroker: { type: mongoose.Schema.Types.ObjectId, ref: 'BrokerDetail', required: true },
      },
    ],

  
    updatedAt: { type: Date, default: Date.now },

    // Extra
    notes: { type: String },
  },
  { timestamps: true }
);

// Keep explicit updatedAt in sync on save
leadSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Keep explicit updatedAt in sync on findOneAndUpdate
leadSchema.pre('findOneAndUpdate', function(next) {
  this.set({ updatedAt: new Date() });
  next();
});

export default mongoose.model('Lead', leadSchema);


