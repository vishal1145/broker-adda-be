import mongoose from "mongoose";

const propertySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    // Detailed long description
    propertyDescription: { type: String },

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

    // Property size (numeric, optional)
    propertySize: { type: Number },

    address: { type: String, required: true },
    city: { type: String, default: "Agra" },
    region: { type: mongoose.Schema.Types.ObjectId, ref: "Region", required: true },
    
    // Coordinates from address geocoding
    latitude: { type: Number },
    longitude: { type: Number },
    
    // Hot property flag
    isHotProperty: { type: Boolean, default: false },

    bedrooms: { type: Number },
    bathrooms: { type: Number },
    furnishing: { type: String, enum: ["Furnished","Semi-Furnished","Unfurnished"] },
    amenities: [{ type: String }],
    // Nearby amenities as separate list
    nearbyAmenities: [{ type: String }],
    // Feature highlights
    features: [{ type: String }],
    // Location benefits/highlights
    locationBenefits: [{ type: String }],

    images: [{ type: String }],
    videos: [{ type: String }],

    broker: { type: mongoose.Schema.Types.ObjectId, ref: "BrokerDetail", required: true },

    transfers: [{ type: mongoose.Schema.Types.ObjectId, ref: "BrokerDetail" }],

    // Listing meta
    facingDirection: {
      type: String,
      enum: ["North", "East", "South", "West"],
    },
    possessionStatus: {
      type: String,
      enum: ["Ready to Move", "Under Construction", "Upcoming"],
    },
    postedBy: {
      type: String,
      enum: ["Broker",  "Admin"],
    },
    createdBy: {
      type: String,
      enum: ["broker", "customer"],
    },
    verificationStatus: {
      type: String,
      enum: ["Verified", "Unverified"],
      default: "Unverified"
    },
    // Age of property in years (optional). Used for filters like <5, <10, >10
    propertyAgeYears: { type: Number, min: 0 },

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
