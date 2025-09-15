import mongoose from 'mongoose';

const regionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Region name is required'],
    unique: true,
    trim: true,
    maxlength: [100, 'Region name cannot be more than 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true,
    maxlength: [50, 'State name cannot be more than 50 characters']
  },
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true,
    maxlength: [50, 'City name cannot be more than 50 characters']
  },
  centerLocation: {
    type: String,
    required: [true, 'Center location is required'],
    trim: true,
    maxlength: [500, 'Center location cannot be more than 500 characters']
  },
  radius: {
    type: Number,
    required: [true, 'Radius is required']
  },
  brokerCount: {
    type: Number,
    default: 0,
    min: [0, 'Broker count cannot be negative']
  }
}, {
  timestamps: true
});

export default mongoose.model('Region', regionSchema);

