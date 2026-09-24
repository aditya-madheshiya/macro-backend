const mongoose = require('mongoose');

const PayoutSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  upiId: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'rejected'],
    default: 'pending'
  },
  transactionId: {
    type: String,
    default: '' // पैसे भेजने के बाद एडमिन द्वारा दर्ज किया गया UTR नंबर
  }
}, { timestamps: true });

module.exports = mongoose.model('Payout', PayoutSchema);