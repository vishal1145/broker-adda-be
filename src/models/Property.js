import mongoose from "mongoose";

const propertySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },

    propertyType: {
      type: String,
      enum: ["Residential", "Commercial", "Plot", "Other"],
      required: true,
    },
    subType: {
      type: String,
      enum: ["Apartment", "Villa", "Office", "Shop", "Land", "Other"],
    },

    price: { type: Number, required: true },
    priceUnit: { type: String, enum: ["INR", "USD"], default: "INR" },

    address: { type: String, required: true },
    city: { type: String, default: "Agra" },
    region: { type: String, required: true },
    coordinates: { lat: { type: Number }, lng: { type: Number } },

    bedrooms: { type: Number },
    bathrooms: { type: Number },
    furnishing: { type: String, enum: ["Furnished","Semi-Furnished","Unfurnished"] },
    amenities: [{ type: String }],

    images: [{ type: String }],
    videos: [{ type: String }],

    broker: { type: mongoose.Schema.Types.ObjectId, ref: "BrokerDetail", required: true },

    status: {
      type: String,
      enum: ["Active", "Sold", "Expired", "Pending Approval", "Rejected"],
      default: "Pending Approval",
    },
    isFeatured: { type: Boolean, default: false },

    inquiries: [{ type: mongoose.Schema.Types.ObjectId, ref: "Inquiry" }],
    viewsCount: { type: Number, default: 0 },
    notes: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model("Property", propertySchema);
