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
  }
}, {
  timestamps: true
});

export default mongoose.model('Region', regionSchema);

