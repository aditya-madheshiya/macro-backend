const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // 🛒 Item details (Photo reference aur numeric price ke sath)
  items: [{
    photoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Photo',
      required: true
    },
    price: {
      type: Number,
      required: true
    }
  }],
  // 📸 Direct Photos Array (Dashboard queries aur population ko fast banane ke liye)
  photos: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Photo'
  }],
  totalAmount: {
    type: Number,
    required: true,
    default: 0
  },
  // 🔒 Razorpay tracking IDs
  razorpayOrderId: {
    type: String,
    trim: true,
    default: ''
  },
  razorpayPaymentId: {
    type: String,
    trim: true,
    default: ''
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'completed'
  }
}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema);