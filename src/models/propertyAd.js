import mongoose from "mongoose";

const propertyAdSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    price: { type: Number, required: true },
    bhk: { type: Number, required: true },
    areaSqft: { type: Number },
    city: { type: String, required: true },
    locality: { type: String, required: true },
    propertyType: {
      type: String,
      enum: ["Residential", "Commercial"],
      required: true
    },
    media: [{ type: String }],
   cta: {
      type: {
        type: String,
        enum: ["CALL", "WHATSAPP", "DETAILS"],
        default: "CALL"
      },
      phone: {
        type: String,
        default: null
      }
    },
    placement: {
      homePage: { type: Boolean, default: true },
      searchPage: { type: Boolean, default: true },
      sidebar: { type: Boolean, default: true },
      brokerProfile: { type: Boolean, default: true },
      enquiryPage: { type: Boolean, default: true }
    },
    maxImpressions: { type: Number, default: 5000 },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft"
    }
  },
  { timestamps: true }
);

// ✅ DEFAULT EXPORT (IMPORTANT)
export default mongoose.model("PropertyAd", propertyAdSchema);
